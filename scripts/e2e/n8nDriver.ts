// Drives the scenario through real n8n: every event is an HTTP request to a published webhook.
import { WEBHOOK_PATHS } from '../../src/build/workflows.ts';
import type { CapturedEmail, SlackPost } from '../../src/mocks/sinksCore.ts';
import type { MockSms } from '../../src/mocks/twilioCore.ts';
import { CALL_ROWS_SQL, REPLY_ROWS_SQL } from '../../src/sim/runner.ts';
import type { CallRow, ReplyRow, ReportResult, ScenarioDriver } from '../../src/sim/runner.ts';
import { psql } from './stack.ts';
import type { StackPorts, StackSecrets } from './stack.ts';

const expectStatus = async (response: Response, wanted: number, what: string): Promise<string> => {
  const text = await response.text();
  if (response.status !== wanted) {
    throw new Error(`${what} answered ${response.status}, expected ${wanted}: ${text.slice(0, 300)}`);
  }
  return text;
};

export const createN8nDriver = (secrets: StackSecrets, ports: StackPorts): ScenarioDriver => {
  const n8n = `http://127.0.0.1:${ports.n8n}/webhook`;
  const twilio = `http://127.0.0.1:${ports.mockTwilio}`;
  const sinks = `http://127.0.0.1:${ports.mockSinks}`;
  const auth = `Basic ${Buffer.from(`${secrets.webhookUser}:${secrets.webhookPassword}`).toString('base64')}`;
  const form = (path: string, body: Record<string, string>, nowIso: string): Promise<Response> =>
    fetch(`${n8n}/${path}`, {
      method: 'POST',
      headers: { 'authorization': auth, 'content-type': 'application/x-www-form-urlencoded', 'x-hs-test-clock': nowIso },
      body: new URLSearchParams(body),
    });
  const rows = (sql: string): unknown[] => {
    const out = psql(secrets, ports, `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`);
    return JSON.parse(out.trim()) as unknown[];
  };
  return {
    name: 'n8n 2.44.5 in Docker (published workflows, Postgres 17, mock APIs)',
    setClock: async (iso): Promise<void> => {
      await expectStatus(await fetch(`${twilio}/_mock/clock`, { method: 'POST', body: JSON.stringify({ at: iso }) }), 200, 'mock clock');
    },
    statusCallback: async (body, nowIso): Promise<void> => {
      await expectStatus(await form(WEBHOOK_PATHS.missedCall, body, nowIso), 200, 'status callback');
    },
    smsReply: async (body, nowIso): Promise<void> => {
      const response = await form(WEBHOOK_PATHS.smsReply, body, nowIso);
      const text = await expectStatus(response, 200, 'SMS reply webhook');
      if (!text.includes('<Response>')) {
        throw new Error(`SMS reply webhook did not answer with TwiML: ${text.slice(0, 200)}`);
      }
    },
    click: async (token, userAgent, nowIso): Promise<{ status: number; location: string | null }> => {
      const response = await fetch(`${n8n}/${WEBHOOK_PATHS.bookingClick}?t=${encodeURIComponent(token)}`, {
        redirect: 'manual',
        headers: { 'user-agent': userAgent, 'x-hs-test-clock': nowIso },
      });
      await response.arrayBuffer();
      return { status: response.status, location: response.headers.get('location') };
    },
    releaseQueue: async (nowIso): Promise<void> => {
      await expectStatus(await form(WEBHOOK_PATHS.releaseQueue, {}, nowIso), 200, 'release queue');
    },
    dailyReport: async (date, nowIso): Promise<ReportResult> => {
      const response = await fetch(`${n8n}/${WEBHOOK_PATHS.dailyReport}`, {
        method: 'POST',
        headers: { 'authorization': auth, 'content-type': 'application/json', 'x-hs-test-clock': nowIso },
        body: JSON.stringify({ date }),
      });
      const body = JSON.parse(await expectStatus(response, 200, 'daily report')) as { report: ReportResult };
      return body.report;
    },
    sms: async () => ((await (await fetch(`${twilio}/_mock/messages`)).json()) as { messages: MockSms[] }).messages,
    slack: async () => ((await (await fetch(`${sinks}/_mock/slack`)).json()) as { messages: SlackPost[] }).messages,
    emails: async () => ((await (await fetch(`${sinks}/_mock/emails`)).json()) as { emails: CapturedEmail[] }).emails,
    callRows: async () => rows(CALL_ROWS_SQL) as CallRow[],
    replyRows: async () => rows(REPLY_ROWS_SQL) as ReplyRow[],
  };
};
