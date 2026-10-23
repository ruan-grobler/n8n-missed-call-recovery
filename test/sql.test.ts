// Integration tests for the SQL files, run on PGlite (Postgres compiled to WebAssembly).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteRunner } from '../src/sim/engine.ts';
import type { SqlRunner } from '../src/sim/engine.ts';

let db: SqlRunner;
const at = (hhmm: string, day = '2026-10-16'): string => new Date(`${day}T${hhmm}:00+02:00`).toISOString();
const claim = (key: string, phone: string | null, hhmm: string): Promise<Record<string, unknown>[]> =>
  db.run('claim-missed-call.sql', [key, key, phone, 'no-answer', at(hhmm), at(hhmm)]);

beforeEach(async () => {
  db = await createPgliteRunner();
});

afterEach(async () => {
  await db.close();
});

describe('claim-missed-call.sql', () => {
  it('claims a call once and counts every repeat callback', async () => {
    const [first] = await claim('CA1', '+27000000001', '12:00');
    const [second] = await claim('CA1', '+27000000001', '12:00');
    const [third] = await claim('CA1', '+27000000001', '12:01');
    expect(first).toMatchObject({ callback_count: 1, opted_out: false, has_queued: false, last_sent_at: null });
    expect(String(first?.link_token)).toMatch(/^[a-f0-9]{12}$/);
    expect(second).toMatchObject({ callback_count: 2, link_token: first?.link_token });
    expect(third?.callback_count).toBe(3);
    const rows = await db.query('SELECT count(*)::int AS n FROM hs_missed_calls');
    expect(rows[0]?.n).toBe(1);
  });

  it('reports opt outs, earlier texts and waiting texts for the same number', async () => {
    await db.query("INSERT INTO hs_opt_outs (phone_e164, opted_out_at) VALUES ('+27000000009', now())");
    expect((await claim('CA9', '+27000000009', '12:00'))[0]?.opted_out).toBe(true);

    await claim('CA2', '+27000000002', '12:00');
    await db.run('set-call-outcome.sql', ['CA2', 'sent', null, at('12:00'), 'SM1', null]);
    expect((await claim('CA3', '+27000000002', '12:20'))[0]?.last_sent_at).toBe(at('12:00'));

    await claim('CA4', '+27000000004', '22:10');
    await db.run('set-call-outcome.sql', ['CA4', 'queued', at('08:00', '2026-10-17'), null, null, null]);
    expect((await claim('CA5', '+27000000004', '22:40'))[0]?.has_queued).toBe(true);
  });

  it('stores a withheld caller as null', async () => {
    const [row] = await claim('CA6', null, '12:00');
    expect(row?.caller_e164).toBeNull();
    expect(row?.opted_out).toBe(false);
  });
});

describe('set-call-outcome.sql', () => {
  it('keeps earlier values when a step passes null', async () => {
    await claim('CA1', '+27000000001', '22:00');
    await db.run('set-call-outcome.sql', ['CA1', 'queued', at('08:00', '2026-10-17'), null, null, null]);
    const [row] = await db.run('set-call-outcome.sql', ['CA1', 'failed', null, null, null, 'boom']);
    expect(row).toMatchObject({ outcome: 'failed', last_error: 'boom' });
    const [stored] = await db.query("SELECT send_after FROM hs_missed_calls WHERE call_key = 'CA1'");
    expect(stored?.send_after).toBe(at('08:00', '2026-10-17'));
  });

  it('rejects an outcome the schema does not know', async () => {
    await claim('CA1', '+27000000001', '12:00');
    await expect(db.run('set-call-outcome.sql', ['CA1', 'texted', null, null, null, null])).rejects.toThrow(/check constraint/);
  });
});

describe('claim-due-texts.sql', () => {
  it('releases due texts, checks the opt out list again and drops stale ones', async () => {
    const queue = async (key: string, phone: string, called: string, sendAfter: string): Promise<void> => {
      await db.run('claim-missed-call.sql', [key, key, phone, 'busy', called, called]);
      await db.run('set-call-outcome.sql', [key, 'queued', sendAfter, null, null, null]);
    };
    const morning = at('08:00', '2026-10-17');
    await queue('DUE', '+27000000001', at('21:30'), morning);
    await queue('OPTED', '+27000000002', at('22:00'), morning);
    await queue('STALE', '+27000000003', at('07:00', '2026-10-15'), morning);
    await queue('LATER', '+27000000004', at('23:00'), at('08:00', '2026-10-18'));
    await db.query("INSERT INTO hs_opt_outs (phone_e164, opted_out_at) VALUES ('+27000000002', now())");

    const rows = await db.run('claim-due-texts.sql', [morning, at('16:00')]);
    const outcomes = Object.fromEntries(rows.map((row) => [row.call_key, row.outcome]));
    expect(outcomes).toEqual({ DUE: 'sending', OPTED: 'opted_out', STALE: 'expired' });
    expect(rows.every((row) => row.now_iso === morning)).toBe(true);
    expect(await db.run('claim-due-texts.sql', [morning, at('16:00')])).toEqual([]);
  });
});

describe('record-reply.sql and set-reply-action.sql', () => {
  const reply = (sid: string, phone: string, intent: string): Promise<Record<string, unknown>[]> =>
    db.run('record-reply.sql', [sid, phone, intent, at('12:00')]);

  it('stores a reply once and opts out in the same statement', async () => {
    const [first] = await reply('SM1', '+27000000001', 'opt_out');
    const [again] = await reply('SM1', '+27000000001', 'opt_out');
    expect(first).toMatchObject({ is_new: true, opted_out_before: false, opted_out_now: true });
    expect(again).toMatchObject({ is_new: false, opted_out_before: true, opted_out_now: false });
    const [later] = await reply('SM2', '+27000000001', 'book');
    expect(later).toMatchObject({ is_new: true, opted_out_before: true });
  });

  it('returns the link token of the last text that number received', async () => {
    await claim('CA1', '+27000000005', '12:00');
    const [sent] = await db.run('set-call-outcome.sql', ['CA1', 'sent', null, at('12:00'), 'SM9', null]);
    expect(sent?.outcome).toBe('sent');
    const [token] = await db.query("SELECT link_token FROM hs_missed_calls WHERE call_key = 'CA1'");
    const [row] = await reply('SM3', '+27000000005', 'book');
    expect(row?.link_token).toBe(token?.link_token);
    expect((await reply('SM4', '+27000000006', 'book'))[0]?.link_token).toBeNull();
  });

  it('records the action and keeps the detail', async () => {
    await reply('SM5', '+27000000007', 'book');
    expect((await db.run('set-reply-action.sql', ['SM5', 'link_sent', null]))[0]).toMatchObject({ action: 'link_sent', detail: null });
    expect((await db.run('set-reply-action.sql', ['SM5', 'link_failed', 'Twilio error 30003']))[0])
      .toMatchObject({ action: 'link_failed', detail: 'Twilio error 30003', from_e164: '+27000000007' });
  });
});

describe('record-click.sql', () => {
  it('keeps the first tap time and counts every tap', async () => {
    const [row] = await claim('CA1', '+27000000001', '12:00');
    const token = String(row?.link_token);
    expect((await db.run('record-click.sql', [token, at('12:05')]))[0]?.matched).toBe(1);
    expect((await db.run('record-click.sql', [token, at('12:09')]))[0]?.matched).toBe(1);
    expect((await db.run('record-click.sql', ['ffffffffffff', at('12:10')]))[0]?.matched).toBe(0);
    const [stored] = await db.query("SELECT clicked_at, click_count FROM hs_missed_calls WHERE call_key = 'CA1'");
    expect(stored).toEqual({ clicked_at: at('12:05'), click_count: 2 });
  });

  it('flags only the first tap on a real link, which is what time saved counts', async () => {
    const [row] = await claim('CA1', '+27000000001', '12:00');
    const token = String(row?.link_token);
    expect(await db.run('record-click.sql', [token, at('12:05')])).toEqual([{ matched: 1, first_tap: true }]);
    expect(await db.run('record-click.sql', [token, at('12:09')])).toEqual([{ matched: 1, first_tap: false }]);
    expect(await db.run('record-click.sql', ['ffffffffffff', at('12:10')])).toEqual([{ matched: 0, first_tap: false }]);
  });
});

describe('retention.sql', () => {
  it('deletes old calls and replies but keeps every opt out', async () => {
    await db.run('claim-missed-call.sql', ['OLD', 'OLD', '+27000000001', 'busy', at('12:00', '2026-06-01'), at('12:00', '2026-06-01')]);
    await claim('NEW', '+27000000002', '12:00');
    await db.run('record-reply.sql', ['SMOLD', '+27000000001', 'opt_out', at('12:05', '2026-06-01')]);
    const [result] = await db.run('retention.sql', [at('08:00', '2026-07-18')]);
    expect(result).toEqual({ calls_deleted: 1, replies_deleted: 1 });
    expect((await db.query('SELECT call_key FROM hs_missed_calls')).map((row) => row.call_key)).toEqual(['NEW']);
    expect((await db.query('SELECT phone_e164 FROM hs_opt_outs')).map((row) => row.phone_e164)).toEqual(['+27000000001']);
  });
});

describe('daily-report.sql', () => {
  it('returns one row with JSON lists and an opt out count, and no phone numbers', async () => {
    await claim('CA1', '+27000000001', '12:00');
    const [row] = await db.run('daily-report.sql', [at('00:00'), at('00:00', '2026-10-17')]);
    expect(Object.keys(row ?? {})).toEqual(['calls', 'replies', 'opt_outs']);
    expect(JSON.stringify(row)).not.toContain('+27000000001');
    expect(row?.opt_outs).toBe(0);
  });
});
