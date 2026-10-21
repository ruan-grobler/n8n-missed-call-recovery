import { describe, expect, it } from 'vitest';
import { reportWindow } from '../src/logic/clock.ts';
import { buildDailyReport, countReport } from '../src/logic/report.ts';
import type { ReportCallRow } from '../src/logic/report.ts';

const window = reportWindow('2026-10-17T06:00:00.000Z', 'Africa/Johannesburg');
const t = (iso: string): string => new Date(iso).toISOString();
const call = (overrides: Partial<ReportCallRow>): ReportCallRow => ({
  outcome: 'sent', called_at: t('2026-10-16T12:00:00+02:00'), sent_at: null, send_after: null, clicked_at: null, callback_count: 1, ...overrides,
});

describe('countReport', () => {
  it('counts by event time inside the day only', () => {
    const counts = countReport({
      calls: [
        call({ sent_at: t('2026-10-16T12:00:00+02:00'), clicked_at: t('2026-10-16T12:05:00+02:00'), callback_count: 3 }),
        call({ called_at: t('2026-10-15T23:30:00+02:00'), outcome: 'sent', send_after: t('2026-10-16T08:00:00+02:00'), sent_at: t('2026-10-16T08:00:00+02:00') }),
        call({ called_at: t('2026-10-16T22:10:00+02:00'), outcome: 'queued', send_after: t('2026-10-17T08:00:00+02:00') }),
        call({ called_at: t('2026-10-16T23:59:59+02:00'), outcome: 'sent', send_after: t('2026-10-17T08:00:00+02:00'), sent_at: t('2026-10-17T08:00:00+02:00') }),
        call({ called_at: t('2026-10-17T00:00:00+02:00'), outcome: 'repeat_caller' }),
        call({ outcome: 'failed' }),
        call({ outcome: 'sending' }),
        call({ outcome: 'expired' }),
      ],
      replies: [
        { intent: 'book', action: 'link_sent', received_at: t('2026-10-16T12:10:00+02:00') },
        { intent: 'other', action: 'manager_alerted', received_at: t('2026-10-16T12:11:00+02:00') },
        { intent: 'opt_out', action: 'opted_out', received_at: t('2026-10-15T12:11:00+02:00') },
      ],
      opt_outs: '2',
    }, window);
    expect(counts).toMatchObject({
      missedCalls: 6,
      missedCallTexts: 2,
      bookingLinksResent: 1,
      textsSent: 3,
      replies: 2,
      repliesBook: 1,
      repliesOther: 1,
      bookingsClicked: 1,
      optOuts: 2,
      heldForMorning: 2,
      expired: 1,
      notTexted: 1,
      failedSends: 1,
      stuckSends: 1,
      duplicateCallbacks: 2,
      managerAlerts: 2,
    });
  });
});

describe('buildDailyReport', () => {
  it('writes a plain text report with correct plurals and no numbers of people', () => {
    const report = buildDailyReport({
      calls: [call({ sent_at: t('2026-10-16T12:00:00+02:00') }), call({ outcome: 'sending' })],
      replies: [{ intent: 'book', action: 'link_sent', received_at: t('2026-10-16T12:10:00+02:00') }],
      opt_outs: 0,
    }, window, 'Harbour Slice', '08:00');
    expect(report.subject).toBe('Harbour Slice missed call report, Friday 16 October 2026');
    expect(report.text).toContain('Texts sent: 2 (1 missed call text, 1 booking link on request)');
    expect(report.text).toContain('Stuck sends: 1 (check the n8n executions list)');
    expect(report.text).toContain('Failed sends: 0\n');
    expect(report.text).not.toMatch(/\+27/);
  });

  it('handles a quiet day', () => {
    const report = buildDailyReport({ calls: [], replies: [], opt_outs: null }, window, 'Harbour Slice', '08:00');
    expect(report.counts.missedCalls).toBe(0);
    expect(report.text).toContain('Not texted: 0\n');
    expect(report.text).not.toContain('Stuck sends');
  });

  it('explains every reason a call was not texted', () => {
    const report = buildDailyReport({
      calls: ['repeat_caller', 'opted_out', 'no_caller_id', 'foreign_number', 'foreign_number', 'expired'].map((outcome) => call({ outcome })),
      replies: [],
      opt_outs: 0,
    }, window, 'Harbour Slice', '07:30');
    expect(report.text).toContain('Not texted: 6 (1 repeat caller already texted, 1 opted out, 1 no caller ID, 2 foreign numbers, 1 too old to send)');
    expect(report.text).toContain('Waiting for 07:30 (quiet hours): 0');
  });
});
