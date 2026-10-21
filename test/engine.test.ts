// Integration tests: the whole synthetic day, plus failure paths, through the in-process engine.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { KitConfig } from '../src/build/workflows.ts';
import { createSinksCore } from '../src/mocks/sinksCore.ts';
import { createTwilioCore } from '../src/mocks/twilioCore.ts';
import { createEngine, createPgliteRunner } from '../src/sim/engine.ts';
import type { SqlRunner } from '../src/sim/engine.ts';
import { formatResult } from '../src/sim/format.ts';
import { PHONE_AGENT, PREVIEW_BOT_AGENT, runScenario } from '../src/sim/runner.ts';
import { createSimDriver } from '../src/sim/simDriver.ts';

const config = JSON.parse(readFileSync(new URL('../config/e2e.json', import.meta.url), 'utf8')) as KitConfig;
const at = (hhmm: string, day = '2026-10-16'): string => `${day}T${hhmm}:00+02:00`;
const callback = (sid: string, from: string): Record<string, string> => ({ CallSid: sid, From: from, CallStatus: 'no-answer' });

const setup = async (overrides: Record<string, string | number | boolean> = {}, failTo: string[] = []): Promise<{
  engine: ReturnType<typeof createEngine>; db: SqlRunner; twilio: ReturnType<typeof createTwilioCore>; sinks: ReturnType<typeof createSinksCore>;
}> => {
  const db = await createPgliteRunner();
  const twilio = createTwilioCore(failTo);
  const sinks = createSinksCore();
  return { engine: createEngine({ db, twilio, sinks, config: { ...config, ...overrides } }), db, twilio, sinks };
};

describe('the synthetic Harbour Slice day', () => {
  it('passes every check in the answer key', async () => {
    const { driver, close } = await createSimDriver(config);
    const result = await runScenario(driver);
    await close();
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(result.report.counts.missedCalls).toBe(40);
    expect(result.metrics).toEqual({ quietHourTexts: 0, extraTexts: 0, textsAfterOptOut: 0 });
    const output = formatResult('title', result);
    expect(output).toContain('12 of 12 passed');
    expect(output).toContain('32 of 40 missed callers got a booking link text');
  });
});

describe('engine paths the scenario does not cover', () => {
  it('ignores a callback that is not a missed call', async () => {
    const { engine, twilio, db } = await setup();
    expect(await engine.statusCallback({ CallSid: 'CA1', From: '+27000000001', CallStatus: 'completed' }, at('12:00'))).toBe('ignored');
    expect(twilio.messages()).toHaveLength(0);
    await db.close();
  });

  it('does nothing at the release tick while it is still quiet hours', async () => {
    const { engine, db } = await setup();
    expect(await engine.releaseQueue(at('07:45'))).toBe(0);
    expect(await engine.releaseQueue(at('08:00'))).toBe(0);
    await db.close();
  });

  it('alerts the manager when the booking link resend fails, and only emails when Slack is off', async () => {
    const { engine, sinks, db } = await setup({ notify_slack: false, notify_email: true }, ['+27000000050']);
    expect(await engine.smsReply({ MessageSid: 'SM1', From: '+27000000050', Body: 'YES' }, at('12:00'))).toBe('link_failed');
    expect(sinks.slack()).toHaveLength(0);
    expect(sinks.emails()).toHaveLength(1);
    expect(sinks.emails()[0]?.text).toContain("but the SMS failed. 'To' number is not a valid mobile number (Twilio error 21614)");
    const [row] = await db.query("SELECT action, detail FROM hs_sms_replies WHERE message_sid = 'SM1'");
    expect(row?.action).toBe('link_failed');
    await db.close();
  });

  it('rejects a reply without a MessageSid', async () => {
    const { engine, db } = await setup();
    expect(await engine.smsReply({ From: '+27000000050', Body: 'YES' }, at('12:00'))).toBe('invalid');
    await db.close();
  });

  it('still redirects the customer when recording the tap fails', async () => {
    const { engine, db } = await setup();
    await db.close();
    expect(await engine.click('abc123def456', PHONE_AGENT, at('12:00'))).toEqual({ status: 302, location: 'https://book.example.com/harbour-slice' });
    expect(await engine.click('abc123def456', PREVIEW_BOT_AGENT, at('12:00'))).toEqual({ status: 403, location: null });
  });

  it('texts a caller again once the cooldown has passed', async () => {
    const { engine, twilio, db } = await setup();
    await engine.statusCallback(callback('CA1', '+27000000001'), at('09:00'));
    await engine.statusCallback(callback('CA2', '+27000000001'), at('12:00'));
    await engine.statusCallback(callback('CA3', '+27000000001'), at('15:01'));
    expect(twilio.messages().map((sms) => sms.to)).toEqual(['+27000000001', '+27000000001']);
    await db.close();
  });

  it('drops a queued text that is too old to make sense', async () => {
    const { engine, twilio, db } = await setup({ stale_after_hours: 8 });
    await engine.statusCallback(callback('CA1', '+27000000001'), at('21:30', '2026-10-15'));
    expect(await engine.releaseQueue(at('08:00', '2026-10-16'))).toBe(0);
    expect(twilio.messages()).toHaveLength(0);
    const [row] = await db.query("SELECT outcome FROM hs_missed_calls WHERE call_key = 'CA1'");
    expect(row?.outcome).toBe('expired');
    await db.close();
  });
});
