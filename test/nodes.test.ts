// The node functions are what the Code nodes call. These tests feed them items shaped like n8n's.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alertText } from '../src/nodes/alertText.ts';
import { buildReportNode } from '../src/nodes/buildReport.ts';
import { decideCall } from '../src/nodes/decideCall.ts';
import { decideReply } from '../src/nodes/decideReply.ts';
import { describeFailure } from '../src/nodes/describeFailure.ts';
import { describeLinkFailure } from '../src/nodes/describeLinkFailure.ts';
import { failureAlert } from '../src/nodes/failureAlert.ts';
import { prepareSms } from '../src/nodes/prepareSms.ts';
import { readCallStatus } from '../src/nodes/readCallStatus.ts';
import { readClick } from '../src/nodes/readClick.ts';
import { readReply } from '../src/nodes/readReply.ts';
import { releaseWindow } from '../src/nodes/releaseWindow.ts';
import { reportWindowNode } from '../src/nodes/reportWindow.ts';
import { TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_D } from './fixtures.ts';

const cfg = JSON.parse(readFileSync(new URL('../config/default.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const testCfg = { ...cfg, test_clock_enabled: true };
const REAL_NOW = '2026-10-21T10:00:00.000+02:00';

describe('readCallStatus', () => {
  const item = { headers: { 'x-hs-test-clock': '2026-10-16T22:10:00+02:00' }, body: { CallSid: 'CA1', From: '0000000002', CallStatus: 'busy' } };

  it('ignores the test clock header in the shipped config', () => {
    expect(readCallStatus({ ...item, ...cfg }, REAL_NOW).now_iso).toBe('2026-10-21T08:00:00.000Z');
  });

  it('uses the test clock header when the e2e config switches it on', () => {
    expect(readCallStatus({ ...item, ...testCfg }, REAL_NOW)).toMatchObject({
      is_missed: true, call_key: 'CA1', caller_e164: '+27000000002', now_iso: '2026-10-16T20:10:00.000Z', called_at: '2026-10-16T20:10:00.000Z',
    });
  });
});

describe('decideCall', () => {
  it('passes the claim and the decision on to the next nodes', () => {
    const call = { call_key: 'CA1', caller_issue: null, now_iso: '2026-10-16T20:10:00.000Z' };
    const claim = { call_key: 'CA1', caller_e164: '+27000000002', link_token: TOKEN_A, callback_count: 1, opted_out: false, last_sent_at: null, has_queued: false };
    expect(decideCall(claim, call, cfg)).toEqual({
      action: 'queue', outcome: null, send_after: '2026-10-17T06:00:00.000Z', reason: 'quiet hours 21:00 to 08:00',
      call_key: 'CA1', caller_e164: '+27000000002', link_token: TOKEN_A, now_iso: '2026-10-16T20:10:00.000Z',
    });
    expect(decideCall({ ...claim, caller_e164: null }, { ...call, caller_issue: 'withheld' }, cfg)).toMatchObject({ action: 'skip', outcome: 'no_caller_id', caller_e164: null });
    expect(decideCall({ link_token: null }, { call_key: 'CA2', caller_issue: 'odd', now_iso: call.now_iso }, cfg)).toMatchObject({ action: 'duplicate', call_key: 'CA2', link_token: '' });
  });
});

describe('releaseWindow', () => {
  it('holds texts during quiet hours and releases them after', () => {
    const at = (iso: string): Record<string, unknown> => ({ headers: { 'x-hs-test-clock': iso }, ...testCfg });
    expect(releaseWindow(at('2026-10-17T07:45:00+02:00'), REAL_NOW).release).toBe(false);
    expect(releaseWindow(at('2026-10-17T08:00:00+02:00'), REAL_NOW)).toEqual({
      release: true, reason: 'outside quiet hours, due texts can go out', now_iso: '2026-10-17T06:00:00.000Z', stale_before: '2026-10-16T14:00:00.000Z',
    });
  });
});

describe('prepareSms', () => {
  it('builds the Twilio request and skips everything that must not be sent', () => {
    const prepared = prepareSms([
      { action: 'send', call_key: 'CA1', caller_e164: '+27000000001', link_token: TOKEN_A, now_iso: 'NOW' },
      { outcome: 'sending', call_key: 'CA2', caller_e164: '+27000000002', link_token: TOKEN_B, now_iso: 'NOW' },
      { outcome: 'opted_out', call_key: 'CA3', caller_e164: '+27000000003', link_token: TOKEN_C },
      { success: true },
      { action: 'send', call_key: 'CA4', caller_e164: null, link_token: TOKEN_D },
    ], cfg);
    expect(prepared.map((sms) => sms.call_key)).toEqual(['CA1', 'CA2']);
    expect(prepared[0]).toEqual({
      call_key: 'CA1',
      sms_to: '+27000000001',
      sms_from: '+27000000000',
      sms_body: 'Harbour Slice: sorry we missed your call! Book or order here: https://n8n.example.com/webhook/hs/book?t=abc123def456 Reply STOP to opt out.',
      segments: 1,
      twilio_messages_url: 'https://api.twilio.com/2010-04-01/Accounts/ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/Messages.json',
      now_iso: 'NOW',
    });
  });
});

describe('dead letter path', () => {
  it('describes the failure and alerts once per failed row', () => {
    const failure = describeFailure({ error: { message: '400 - "{\\"code\\":21614,\\"message\\":\\"Nope\\"}"' } }, { call_key: 'CA1', sms_to: '+27000000035' });
    expect(failure).toEqual({ call_key: 'CA1', caller_e164: '+27000000035', error_text: 'Nope (Twilio error 21614)' });
    expect(describeFailure({}, {})).toMatchObject({ call_key: '', caller_e164: '' });
    const alerts = failureAlert([
      { call_key: 'CA1', outcome: 'failed', caller_e164: '+27000000035', called_at: '2026-10-16T17:12:00.000Z', last_error: failure.error_text },
      { call_key: 'CA2', outcome: 'sent', caller_e164: '+27000000002' },
      { success: true },
    ], cfg);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.alert_text).toContain('+27 00 000 0035, called at 19:12). Nope (Twilio error 21614). Please call them back.');
  });
});

describe('reply nodes', () => {
  const smsItem = (body: Record<string, unknown>): Record<string, unknown> => ({ headers: { 'x-hs-test-clock': '2026-10-16T12:40:00+02:00' }, body, ...testCfg });

  it('reads and classifies a reply, and flags a malformed one', () => {
    expect(readReply(smsItem({ MessageSid: 'SM1', From: '+27000000011', Body: 'YES' }), REAL_NOW)).toEqual({
      valid: true, ignore_reason: null, message_sid: 'SM1', from_e164: '+27000000011', intent: 'book', preview: 'YES', now_iso: '2026-10-16T10:40:00.000Z',
    });
    expect(readReply(smsItem({ From: 'anonymous', Body: 'hi' }), REAL_NOW)).toMatchObject({ valid: false, from_e164: null });
  });

  it('sends the tracked link back, or the plain booking link for a stranger', () => {
    const reply = { message_sid: 'SM1', from_e164: '+27000000011', intent: 'book', now_iso: 'NOW' };
    const withToken = decideReply({ is_new: true, opted_out_before: false, link_token: TOKEN_A }, reply, cfg);
    expect(withToken).toMatchObject({ action: 'link_sent', is_new: true, sms_to: '+27000000011' });
    expect(withToken.sms_body).toBe('Harbour Slice: here is the booking link again: https://n8n.example.com/webhook/hs/book?t=abc123def456 Reply STOP to opt out.');
    expect(decideReply({ is_new: true, opted_out_before: false, link_token: null }, reply, cfg).sms_body).toContain('https://book.example.com/harbour-slice');
    expect(decideReply({ is_new: true, opted_out_before: true }, reply, cfg)).toMatchObject({ action: 'blocked_opted_out', sms_to: '', sms_body: '' });
    expect(decideReply({ is_new: false }, { ...reply, intent: 'weird' }, cfg)).toMatchObject({ action: 'duplicate', is_new: false });
  });

  it('writes the right alert for each case', () => {
    const reply = { from_e164: '+27000000028', now_iso: '2026-10-16T17:08:00.000Z', preview: 'Gluten free?' };
    expect(alertText({ action: 'manager_alerted', from_e164: '+27000000028' }, reply, cfg).alert_subject).toBe('Harbour Slice: new SMS reply from a missed caller');
    expect(alertText({ action: 'blocked_opted_out' }, reply, cfg).alert_text).toContain('opted out earlier');
    expect(alertText({ action: 'link_failed', from_e164: '+27000000028', detail: 'Twilio error 30003' }, reply, cfg).alert_text).toContain('Twilio error 30003');
    expect(alertText({ action: 'link_failed' }, {}, cfg).alert_text).toContain('unknown error');
    expect(describeLinkFailure({ error: { message: 'socket hang up' } }, { message_sid: 'SM1' })).toEqual({ message_sid: 'SM1', error_text: 'socket hang up' });
  });

  it('reads a click token and rejects a malformed one', () => {
    const click = (t: unknown): Record<string, unknown> => ({ query: { t }, headers: {}, ...cfg });
    expect(readClick(click(TOKEN_A.toUpperCase()), REAL_NOW)).toEqual({ token: TOKEN_A, valid: true, now_iso: '2026-10-21T08:00:00.000Z' });
    expect(readClick(click("1' OR '1'='1"), REAL_NOW).valid).toBe(false);
    expect(readClick({ ...cfg }, REAL_NOW)).toMatchObject({ token: '', valid: false });
  });
});

describe('report nodes', () => {
  it('works out the window and builds the report from the SQL row', () => {
    const window = reportWindowNode({ headers: { 'x-hs-test-clock': '2026-10-17T08:00:00+02:00' }, body: {}, ...testCfg }, REAL_NOW);
    expect(window).toMatchObject({ date: '2026-10-16', start_iso: '2026-10-15T22:00:00.000Z', retention_before: '2026-07-19T06:00:00.000Z' });
    const built = buildReportNode({
      calls: JSON.stringify([{ outcome: 'sent', called_at: '2026-10-16T10:00:00+00:00', sent_at: '2026-10-16T10:00:00+00:00', send_after: null, clicked_at: null, callback_count: 1 }]),
      replies: [],
      opt_outs: 0,
    }, { ...window }, cfg);
    expect(built.counts).toMatchObject({ missedCalls: 1, missedCallTexts: 1 });
    expect(built.alert_text).toBe(built.text);
    expect(buildReportNode({ calls: 'not json either way'.length, replies: null }, { ...window }, cfg).counts.missedCalls).toBe(0);
  });
});
