// Replays the synthetic day through a driver (in-process engine or real n8n) and checks the answer key.
import { DateTime } from 'luxon';
import {
  CALLS,
  DAY,
  DUPLICATE_CALLBACKS,
  DUPLICATE_REPLIES,
  EXPECTED_REPORT,
  PROLOGUE_CALL,
  PROLOGUE_REPLY,
  REPLIES,
  SHOP_LINE,
  buildTimeline,
} from '../../scenarios/harbour-slice-day.ts';
import type { ScenarioCall, ScenarioReply } from '../../scenarios/harbour-slice-day.ts';
import { isQuietHours } from '../logic/clock.ts';
import type { ReportCounts } from '../logic/report.ts';
import type { CapturedEmail, SlackPost } from '../mocks/sinksCore.ts';
import type { MockSms } from '../mocks/twilioCore.ts';

export interface CallRow {
  call_key: string;
  outcome: string;
  link_token: string;
  send_after: string | null;
  sent_at: string | null;
}

export interface ReplyRow {
  message_sid: string;
  action: string;
}

export interface ReportResult {
  subject: string;
  text: string;
  counts: ReportCounts;
}

export interface ScenarioDriver {
  name: string;
  setClock: (iso: string) => Promise<void>;
  statusCallback: (form: Record<string, string>, nowIso: string) => Promise<void>;
  smsReply: (form: Record<string, string>, nowIso: string) => Promise<void>;
  click: (token: string, userAgent: string, nowIso: string) => Promise<{ status: number; location: string | null }>;
  releaseQueue: (nowIso: string) => Promise<void>;
  dailyReport: (date: string, nowIso: string) => Promise<ReportResult>;
  sms: () => Promise<MockSms[]>;
  slack: () => Promise<SlackPost[]>;
  emails: () => Promise<CapturedEmail[]>;
  callRows: () => Promise<CallRow[]>;
  replyRows: () => Promise<ReplyRow[]>;
}

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ScenarioMetrics {
  quietHourTexts: number;
  extraTexts: number;
  textsAfterOptOut: number;
}

export interface ScenarioResult {
  driver: string;
  metrics: ScenarioMetrics;
  report: ReportResult;
  checks: Check[];
  sms: MockSms[];
  slack: SlackPost[];
  emails: CapturedEmail[];
  callRows: CallRow[];
  requests: number;
}

// Read back by both drivers after the run, to compare against the answer key.
export const CALL_ROWS_SQL = 'SELECT call_key, outcome, link_token, send_after, sent_at FROM hs_missed_calls ORDER BY called_at';
export const REPLY_ROWS_SQL = 'SELECT message_sid, action FROM hs_sms_replies ORDER BY received_at';

export const TIMEZONE = 'Africa/Johannesburg';
export const BOOKING_URL = 'https://book.example.com/harbour-slice';
export const SHOP_HANDSET = '+27000000099';
export const PHONE_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
// Message apps fetch link previews with crawler user agents like this one.
export const PREVIEW_BOT_AGENT = 'facebookexternalhit/1.1 Facebot Twitterbot/1.0';

const ALL_CALLS: readonly ScenarioCall[] = [PROLOGUE_CALL, ...CALLS];
const ALL_REPLIES: readonly ScenarioReply[] = [PROLOGUE_REPLY, ...REPLIES];
const hexSid = (prefix: string, n: number): string => `${prefix}${n.toString(16).padStart(32, '0')}`;

export const callSid = (id: string): string => hexSid('CA', 0xca11000 + ALL_CALLS.findIndex((item) => item.id === id));
export const secondHandsetSid = (id: string): string => hexSid('CA', 0xca12000 + ALL_CALLS.findIndex((item) => item.id === id));
export const parentSid = (parent: string): string => hexSid('CA', 0xba5e000 + Number(parent.replace(/\D/g, '')));
export const messageSid = (id: string): string => hexSid('SM', 0x5e000 + ALL_REPLIES.findIndex((item) => item.id === id));
export const callKeyFor = (item: ScenarioCall): string => (item.parent ? parentSid(item.parent) : callSid(item.id));

const rfc2822 = (iso: string): string => new Date(iso).toUTCString().replace('GMT', '+0000');

export const callbackForm = (item: ScenarioCall, at: string, secondHandset = false): Record<string, string> => ({
  AccountSid: 'AC00000000000000000000000000000000',
  ApiVersion: '2010-04-01',
  CallbackSource: 'call-progress-events',
  CallSid: secondHandset ? secondHandsetSid(item.id) : callSid(item.id),
  ...(item.parent ? { ParentCallSid: parentSid(item.parent) } : {}),
  CallStatus: item.status,
  Direction: 'outbound-dial',
  From: item.from,
  To: SHOP_HANDSET,
  Timestamp: rfc2822(at),
  SequenceNumber: '0',
});

export const answeredForm = (from: string, at: string, n: number): Record<string, string> => ({
  AccountSid: 'AC00000000000000000000000000000000',
  ApiVersion: '2010-04-01',
  CallbackSource: 'call-progress-events',
  CallSid: hexSid('CA', 0xa45000 + n),
  CallStatus: 'completed',
  CallDuration: '94',
  Direction: 'outbound-dial',
  From: from,
  To: SHOP_HANDSET,
  Timestamp: rfc2822(at),
  SequenceNumber: '0',
});

export const replyForm = (item: ScenarioReply): Record<string, string> => ({
  AccountSid: 'AC00000000000000000000000000000000',
  ApiVersion: '2010-04-01',
  MessageSid: messageSid(item.id),
  From: item.from,
  To: SHOP_LINE,
  Body: item.body,
  NumMedia: '0',
  NumSegments: '1',
});

const tokenOf = (body: string): string | null => /[?&]t=([a-f0-9]{12})/.exec(body)?.[1] ?? null;
const isRecoveryText = (sms: MockSms): boolean => sms.body.includes('sorry we missed your call');
const localHhmm = (iso: string): string => DateTime.fromISO(iso).setZone(TIMEZONE).toFormat('HH:mm');

const check = (name: string, failures: readonly string[], okDetail: string): Check => ({
  name,
  passed: failures.length === 0,
  detail: failures.length === 0 ? okDetail : failures.slice(0, 5).join('; '),
});

export const runScenario = async (driver: ScenarioDriver): Promise<ScenarioResult> => {
  const byId = new Map(ALL_CALLS.map((item) => [item.id, item]));
  const repliesById = new Map(ALL_REPLIES.map((item) => [item.id, item]));
  const duplicateDeltas: string[] = [];
  const answeredDeltas: string[] = [];
  const clickResults: { at: string; agent: string; status: number; location: string | null; expectedCount: boolean }[] = [];
  let report: ReportResult | null = null;
  let requests = 0;

  for (const event of buildTimeline()) {
    await driver.setClock(event.at);
    requests += 1;
    if (event.kind === 'call') {
      await driver.statusCallback(callbackForm(event.call, event.at), event.at);
    } else if (event.kind === 'duplicate-callback') {
      const original = byId.get(event.callId);
      if (!original) {
        throw new Error(`Unknown call ${event.callId}`);
      }
      const before = (await driver.sms()).length;
      await driver.statusCallback(callbackForm(original, event.at, event.secondHandset), event.at);
      const delta = (await driver.sms()).length - before;
      if (delta !== 0) {
        duplicateDeltas.push(`${event.callId} duplicate sent ${delta} texts`);
      }
    } else if (event.kind === 'answered') {
      const before = (await driver.sms()).length;
      await driver.statusCallback(answeredForm(event.from, event.at, requests), event.at);
      if ((await driver.sms()).length !== before) {
        answeredDeltas.push(`answered call from ${event.from} was texted`);
      }
    } else if (event.kind === 'reply') {
      await driver.smsReply(replyForm(event.reply), event.at);
    } else if (event.kind === 'duplicate-reply') {
      const original = repliesById.get(event.replyId);
      if (!original) {
        throw new Error(`Unknown reply ${event.replyId}`);
      }
      const before = (await driver.sms()).length;
      await driver.smsReply(replyForm(original), event.at);
      const delta = (await driver.sms()).length - before;
      if (delta !== 0) {
        duplicateDeltas.push(`${event.replyId} duplicate webhook sent ${delta} texts`);
      }
    } else if (event.kind === 'click') {
      const { click } = event;
      let token = 'ffffffffffff';
      if (click.number !== 'invalid') {
        const latest = (await driver.sms()).filter((sms) => sms.to === click.number).at(-1);
        token = latest ? tokenOf(latest.body) ?? '' : '';
      }
      const result = await driver.click(token, click.agent === 'phone' ? PHONE_AGENT : PREVIEW_BOT_AGENT, event.at);
      clickResults.push({ at: event.at, agent: click.agent, ...result, expectedCount: click.counts });
    } else if (event.kind === 'release') {
      await driver.releaseQueue(event.at);
    } else {
      report = await driver.dailyReport(event.date, event.at);
    }
  }

  if (!report) {
    throw new Error('The scenario never ran the daily report');
  }
  const sms = await driver.sms();
  const slack = await driver.slack();
  const emails = await driver.emails();
  const callRows = await driver.callRows();
  const replyRows = await driver.replyRows();
  const rowsByKey = new Map(callRows.map((row) => [row.call_key, row]));

  const outcomeFailures = ALL_CALLS.flatMap((item) => {
    const row = rowsByKey.get(callKeyFor(item));
    return row?.outcome === item.expect ? [] : [`${item.id} expected ${item.expect}, got ${row?.outcome ?? 'no row'}`];
  });

  const recovery = sms.filter(isRecoveryText);
  const perCallFailures = ALL_CALLS.flatMap((item) => {
    const token = rowsByKey.get(callKeyFor(item))?.link_token ?? '';
    const count = recovery.filter((text) => tokenOf(text.body) === token).length;
    const wanted = item.expect === 'sent' ? 1 : 0;
    return count === wanted ? [] : [`${item.id} got ${count} texts, expected ${wanted}`];
  });
  const strayFailures = recovery
    .filter((text) => !callRows.some((row) => row.link_token === tokenOf(text.body)))
    .map((text) => `text to ${text.to} matches no call`);

  const quietFailures = sms
    .filter((text) => text.simulatedAt === null || isQuietHours(text.simulatedAt, TIMEZONE, '21:00', '08:00'))
    .map((text) => `text to ${text.to} at ${text.simulatedAt ?? 'unknown time'}`);

  const queuedFailures = CALLS.filter((item) => item.queuedUntil).flatMap((item) => {
    const token = rowsByKey.get(callKeyFor(item))?.link_token ?? '';
    const text = recovery.find((candidate) => tokenOf(candidate.body) === token);
    const wantedDay = item.queuedUntil === '08:00' ? DAY : '2026-10-17';
    const sentAt = text?.simulatedAt ? DateTime.fromISO(text.simulatedAt).setZone(TIMEZONE) : null;
    return sentAt && sentAt.toISODate() === wantedDay && sentAt.toFormat('HH:mm') === '08:00'
      ? []
      : [`${item.id} went out at ${text?.simulatedAt ?? 'never'}, expected ${wantedDay} 08:00`];
  });

  const optOutFailures = ALL_REPLIES.filter((item) => item.expect === 'opted_out').flatMap((item) =>
    sms.filter((text) => text.to === item.from && text.simulatedAt !== null && Date.parse(text.simulatedAt) > Date.parse(item.at))
      .map((text) => `${item.from} opted out at ${localHhmm(item.at)} but got a text at ${localHhmm(text.simulatedAt ?? '')}`));

  const replyFailures = ALL_REPLIES.flatMap((item) => {
    const row = replyRows.find((candidate) => candidate.message_sid === messageSid(item.id));
    return row?.action === item.expect ? [] : [`${item.id} expected ${item.expect}, got ${row?.action ?? 'no row'}`];
  });
  const storedReplyFailures = replyRows.length === ALL_REPLIES.length
    ? []
    : [`expected ${ALL_REPLIES.length} stored replies, found ${replyRows.length}`];

  const clickFailures = clickResults.flatMap((result) => {
    if (result.agent === 'preview-bot') {
      return result.status === 403 ? [] : [`preview bot got ${result.status}, expected 403`];
    }
    return result.status === 302 && result.location === BOOKING_URL ? [] : [`tap at ${localHhmm(result.at)} got ${result.status}`];
  });

  const countFailures = Object.entries(EXPECTED_REPORT).flatMap(([key, wanted]) => {
    const got = report?.counts[key as keyof ReportCounts];
    return got === wanted ? [] : [`${key}: expected ${wanted}, got ${String(got)}`];
  });
  const piiFailures = /\+?\d[\d ]{8,}\d/.test(report.text) ? ['the report text contains something that looks like a phone number'] : [];

  const alertsExpected = EXPECTED_REPORT.managerAlerts + 1;
  const deliveryFailures = [
    ...(slack.length === alertsExpected ? [] : [`expected ${alertsExpected} Slack posts, got ${slack.length}`]),
    ...(emails.length === alertsExpected ? [] : [`expected ${alertsExpected} emails, got ${emails.length}`]),
  ];

  const sentCalls = ALL_CALLS.filter((item) => item.expect === 'sent').length;
  const checks: Check[] = [
    check('Every call ends with the outcome in the answer key', outcomeFailures, `${ALL_CALLS.length} of ${ALL_CALLS.length} calls match`),
    check('Exactly one text per texted call, none for the rest', [...perCallFailures, ...strayFailures], `${recovery.length} missed call texts for ${sentCalls} texted calls`),
    check('Duplicate webhooks send nothing twice', duplicateDeltas,
      `${DUPLICATE_CALLBACKS.length} duplicate callbacks and ${DUPLICATE_REPLIES.length} duplicate reply, 0 extra texts`),
    check('Answered calls are ignored', answeredDeltas, 'answered calls sent no text'),
    check('No text goes out between 21:00 and 08:00', quietFailures, `${sms.length} texts, all between 08:00 and 21:00`),
    check('Quiet hours calls are texted at 08:00', queuedFailures, `${CALLS.filter((item) => item.queuedUntil).length} queued calls texted at 08:00`),
    check('Nobody is texted after opting out', optOutFailures, `${ALL_REPLIES.filter((item) => item.expect === 'opted_out').length} opt outs, 0 texts after them`),
    check('Every reply gets the right action', [...replyFailures, ...storedReplyFailures], `${ALL_REPLIES.length} replies stored once each`),
    check('Link taps redirect, preview bots are ignored', clickFailures, `${clickResults.length} taps, bot got 403`),
    check('Report numbers match the hand count', countFailures, `${Object.keys(EXPECTED_REPORT).length} numbers match`),
    check('Report carries no phone numbers', piiFailures, 'counts only'),
    check('Manager alerts and the report reach Slack and email', deliveryFailures, `${slack.length} Slack posts, ${emails.length} emails`),
  ];

  const metrics: ScenarioMetrics = {
    quietHourTexts: quietFailures.length,
    extraTexts: perCallFailures.length + strayFailures.length + duplicateDeltas.length,
    textsAfterOptOut: optOutFailures.length,
  };
  return { driver: driver.name, metrics, report, checks, sms, slack, emails, callRows, requests };
};
