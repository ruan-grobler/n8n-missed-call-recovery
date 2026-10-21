// Runs the scenario in-process: the engine, PGlite and the mock cores. No Docker, no network.
import type { KitConfig } from '../build/workflows.ts';
import { createSinksCore } from '../mocks/sinksCore.ts';
import { createTwilioCore } from '../mocks/twilioCore.ts';
import { createEngine, createPgliteRunner } from './engine.ts';
import { CALL_ROWS_SQL, REPLY_ROWS_SQL } from './runner.ts';
import type { CallRow, ReplyRow, ScenarioDriver } from './runner.ts';

// The mock treats this number as a landline, like MOCK_TWILIO_FAIL_TO in docker-compose.yml.
export const LANDLINE = '+27000000035';

export const createSimDriver = async (config: KitConfig): Promise<{ driver: ScenarioDriver; close: () => Promise<void> }> => {
  const db = await createPgliteRunner();
  const twilio = createTwilioCore([LANDLINE]);
  const sinks = createSinksCore();
  const engine = createEngine({ db, twilio, sinks, config });
  const driver: ScenarioDriver = {
    name: 'in-process engine (same node code and SQL, PGlite, mock APIs)',
    setClock: async (iso): Promise<void> => {
      twilio.setClock(iso);
    },
    statusCallback: async (form, nowIso): Promise<void> => {
      await engine.statusCallback(form, nowIso);
    },
    smsReply: async (form, nowIso): Promise<void> => {
      await engine.smsReply(form, nowIso);
    },
    click: (token, userAgent, nowIso) => engine.click(token, userAgent, nowIso),
    releaseQueue: async (nowIso): Promise<void> => {
      await engine.releaseQueue(nowIso);
    },
    dailyReport: (date, nowIso) => engine.dailyReport(date, nowIso),
    sms: async () => twilio.messages(),
    slack: async () => sinks.slack(),
    emails: async () => sinks.emails(),
    callRows: async () => (await db.query(CALL_ROWS_SQL)) as unknown as CallRow[],
    replyRows: async () => (await db.query(REPLY_ROWS_SQL)) as unknown as ReplyRow[],
  };
  return { driver, close: () => db.close() };
};
