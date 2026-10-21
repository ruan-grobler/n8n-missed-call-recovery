// In-process copy of the three workflows, node by node, for `npm run demo` and the integration tests.
// It calls the same node functions the Code nodes run and the same SQL files the Postgres nodes run (on PGlite).
// The docker e2e run replays the same scenario through real n8n, which checks that this wiring matches.
import { PGlite } from '@electric-sql/pglite';
import isbot from 'isbot';
import { readSql } from '../build/workflows.ts';
import type { KitConfig } from '../build/workflows.ts';
import type { Alert } from '../logic/alerts.ts';
import type { ConfigItem } from '../logic/config.ts';
import type { SinksCore } from '../mocks/sinksCore.ts';
import type { MockResponse, TwilioCore } from '../mocks/twilioCore.ts';
import { alertText } from '../nodes/alertText.ts';
import { buildReportNode } from '../nodes/buildReport.ts';
import type { BuildReportOut } from '../nodes/buildReport.ts';
import { decideCall } from '../nodes/decideCall.ts';
import { decideReply } from '../nodes/decideReply.ts';
import { describeFailure } from '../nodes/describeFailure.ts';
import { describeLinkFailure } from '../nodes/describeLinkFailure.ts';
import { failureAlert } from '../nodes/failureAlert.ts';
import { prepareSms } from '../nodes/prepareSms.ts';
import type { PreparedSms } from '../nodes/prepareSms.ts';
import { readCallStatus } from '../nodes/readCallStatus.ts';
import { readClick } from '../nodes/readClick.ts';
import { readReply } from '../nodes/readReply.ts';
import { releaseWindow } from '../nodes/releaseWindow.ts';
import { reportWindowNode } from '../nodes/reportWindow.ts';

export type Row = Record<string, unknown>;

export interface SqlRunner {
  // Runs one of the files in sql/, exactly as the matching Postgres node does.
  run: (file: string, params: readonly unknown[]) => Promise<Row[]>;
  query: (sql: string, params?: readonly unknown[]) => Promise<Row[]>;
  close: () => Promise<void>;
}

// Rows go through JSON like n8n items do, so Dates become ISO strings exactly as in n8n.
export const createPgliteRunner = async (): Promise<SqlRunner> => {
  const db = new PGlite();
  await db.exec(readSql('schema.sql'));
  const query = async (sql: string, params: readonly unknown[] = []): Promise<Row[]> => {
    const result = await db.query<Row>(sql, [...params]);
    return JSON.parse(JSON.stringify(result.rows)) as Row[];
  };
  return {
    run: (file, params) => query(readSql(file), params),
    query,
    close: async (): Promise<void> => {
      await db.close();
    },
  };
};

export interface EngineDeps {
  db: SqlRunner;
  twilio: TwilioCore;
  sinks: SinksCore;
  config: KitConfig;
}

export interface Engine {
  statusCallback: (form: Readonly<Record<string, string>>, nowIso: string) => Promise<string>;
  releaseQueue: (nowIso: string) => Promise<number>;
  smsReply: (form: Readonly<Record<string, string>>, nowIso: string) => Promise<string>;
  click: (token: string, userAgent: string, nowIso: string) => Promise<{ status: number; location: string | null }>;
  dailyReport: (date: string, nowIso: string) => Promise<BuildReportOut>;
}

// Mirrors the HTTP Request node: a 4xx or 5xx becomes an error item shaped like n8n's.
const twilioRequest = (twilio: TwilioCore, url: string, form: Readonly<Record<string, string>>): MockResponse => {
  const accountSid = /\/Accounts\/([^/]+)\/Messages\.json$/.exec(url)?.[1] ?? '';
  return twilio.sendMessage(decodeURIComponent(accountSid), form, true);
};

const asErrorItem = (response: MockResponse): Row => ({
  error: { message: `${response.status} - ${JSON.stringify(JSON.stringify(response.body))}`, name: 'AxiosError', status: response.status },
});

export const createEngine = (deps: EngineDeps): Engine => {
  const { db, twilio, sinks } = deps;
  const config: ConfigItem = deps.config;
  // The Config node adds every setting to the webhook item; the test clock rides in a header.
  const item = (nowIso: string, extra: Row): ConfigItem => ({ headers: { 'x-hs-test-clock': nowIso }, ...extra, ...config });

  // "Slack on?" then "Email on?", like the alert chain in the workflows.
  const notify = (alert: Alert): void => {
    if (config.notify_slack === true) {
      sinks.postSlack(true, { channel: config.slack_channel, text: alert.alert_text });
    }
    if (config.notify_email === true) {
      sinks.addEmail({ from: String(config.email_from), to: [String(config.email_to)], subject: alert.alert_subject, text: alert.alert_text });
    }
  };

  // "Send SMS via Twilio", then "Mark sent", or the dead letter path: "Describe failure", "Mark failed", "Failure alert".
  const sendPrepared = async (prepared: readonly PreparedSms[]): Promise<number> => {
    let sent = 0;
    for (const sms of prepared) {
      const response = twilioRequest(twilio, sms.twilio_messages_url, { To: sms.sms_to, From: sms.sms_from, Body: sms.sms_body });
      if (response.status < 300) {
        await db.run('set-call-outcome.sql', [sms.call_key, 'sent', null, sms.now_iso, response.body.sid ?? null, null]);
        sent += 1;
        continue;
      }
      const failure = describeFailure({ ...sms, ...asErrorItem(response) }, { ...sms });
      const rows = await db.run('set-call-outcome.sql', [failure.call_key, 'failed', null, null, null, failure.error_text]);
      for (const alert of failureAlert(rows, config)) {
        notify(alert);
      }
    }
    return sent;
  };

  return {
    statusCallback: async (form, nowIso): Promise<string> => {
      const call = readCallStatus(item(nowIso, { body: form, route: 'call_status' }), nowIso);
      if (!call.is_missed) {
        return 'ignored';
      }
      const [claim] = await db.run('claim-missed-call.sql',
        [call.call_key, call.call_sid, call.caller_e164 ?? null, call.call_status, call.called_at, call.now_iso]);
      const decision = decideCall(claim ?? {}, { ...call }, config);
      if (decision.action === 'send') {
        await sendPrepared(prepareSms([{ ...decision }], config));
      } else if (decision.action === 'queue') {
        await db.run('set-call-outcome.sql', [decision.call_key, 'queued', decision.send_after, null, null, null]);
      } else if (decision.action === 'skip') {
        await db.run('set-call-outcome.sql', [decision.call_key, decision.outcome, null, null, null, null]);
      }
      return decision.action;
    },

    releaseQueue: async (nowIso): Promise<number> => {
      const window = releaseWindow(item(nowIso, { body: {}, route: 'release' }), nowIso);
      if (!window.release) {
        return 0;
      }
      const rows = await db.run('claim-due-texts.sql', [window.now_iso, window.stale_before]);
      // The Postgres node emits {success: true} when an UPDATE returns no rows; Prepare SMS ignores it.
      return sendPrepared(prepareSms(rows.length > 0 ? rows : [{ success: true }], config));
    },

    smsReply: async (form, nowIso): Promise<string> => {
      const reply = readReply(item(nowIso, { body: form, route: 'reply' }), nowIso);
      if (!reply.valid) {
        return 'invalid';
      }
      const [row] = await db.run('record-reply.sql', [reply.message_sid, reply.from_e164, reply.intent, reply.now_iso]);
      const decision = decideReply(row ?? {}, { ...reply }, config);
      if (!decision.is_new) {
        return 'duplicate';
      }
      const [saved] = await db.run('set-reply-action.sql', [decision.message_sid, decision.action, null]);
      if (saved?.action === 'link_sent') {
        const response = twilioRequest(twilio, decision.twilio_messages_url, { To: decision.sms_to, From: decision.sms_from, Body: decision.sms_body });
        if (response.status >= 300) {
          const failure = describeLinkFailure(asErrorItem(response), { ...decision });
          const [failed] = await db.run('set-reply-action.sql', [failure.message_sid, 'link_failed', failure.error_text]);
          notify(alertText(failed ?? {}, { ...reply }, config));
          return 'link_failed';
        }
      } else if (saved?.action === 'manager_alerted' || saved?.action === 'blocked_opted_out') {
        notify(alertText(saved, { ...reply }, config));
      }
      return String(saved?.action ?? 'unknown');
    },

    click: async (token, userAgent, nowIso): Promise<{ status: number; location: string | null }> => {
      // The webhook's "Ignore bots" option answers link preview bots with 403 before the workflow runs.
      if (isbot(userAgent)) {
        return { status: 403, location: null };
      }
      const clickItem = readClick(item(nowIso, { query: { t: token }, route: 'click' }), nowIso);
      try {
        await db.run('record-click.sql', [clickItem.token, clickItem.now_iso]);
      } catch {
        // "Record click" continues on failure, so the customer is always redirected.
      }
      return { status: 302, location: String(config.booking_url) };
    },

    dailyReport: async (date, nowIso): Promise<BuildReportOut> => {
      const window = reportWindowNode(item(nowIso, { body: { date } }), nowIso);
      const [row] = await db.run('daily-report.sql', [window.start_iso, window.end_iso]);
      const report = buildReportNode(row ?? {}, { ...window }, config);
      notify(report);
      await db.run('retention.sql', [window.retention_before]);
      return report;
    },
  };
};
