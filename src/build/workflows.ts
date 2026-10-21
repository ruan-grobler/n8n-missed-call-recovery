// The three workflows as code. `npm run build` writes them to workflows/*.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, generateCodeNode } from './codegen.ts';
import type { CodeNodeSource } from './codegen.ts';
import {
  addNode,
  codeNode,
  connect,
  createDraft,
  emailNode,
  finishWorkflow,
  httpFormPostNode,
  ifNode,
  isTrue,
  manualTriggerNode,
  postgresNode,
  respondRedirectNode,
  respondTextNode,
  scheduleNode,
  setNode,
  slackPostNode,
  stickyNode,
  stringEquals,
  switchNode,
  webhookNode,
} from './n8n.ts';
import type { N8nWorkflow, Position, SetValue, WorkflowDraft } from './n8n.ts';

export type KitConfig = Readonly<Record<string, SetValue>>;

export const WORKFLOW_FILES = {
  capture: '01-missed-call-capture.json',
  replies: '02-replies-and-clicks.json',
  report: '03-daily-report.json',
} as const;

export const WORKFLOW_IDS = {
  capture: 'hsMissedCallCapt',
  replies: 'hsRepliesClicks1',
  report: 'hsDailyReport001',
} as const;

export const WEBHOOK_PATHS = {
  missedCall: 'hs/missed-call',
  releaseQueue: 'hs/release-queue',
  smsReply: 'hs/sms-reply',
  bookingClick: 'hs/book',
  dailyReport: 'hs/daily-report',
} as const;

const CONFIG_KEYS = {
  capture: [
    'business_name', 'timezone', 'quiet_start', 'quiet_end', 'missed_statuses', 'allowed_country_prefixes',
    'repeat_cooldown_minutes', 'stale_after_hours', 'tracked_link_base', 'sms_template', 'twilio_api_base',
    'twilio_account_sid', 'twilio_from', 'notify_slack', 'notify_email', 'slack_api_base', 'slack_channel',
    'email_from', 'email_to', 'test_clock_enabled',
  ],
  replies: [
    'business_name', 'timezone', 'booking_url', 'tracked_link_base', 'rebook_template', 'twilio_api_base',
    'twilio_account_sid', 'twilio_from', 'notify_slack', 'notify_email', 'slack_api_base', 'slack_channel',
    'email_from', 'email_to', 'test_clock_enabled',
  ],
  report: [
    'business_name', 'timezone', 'quiet_end', 'retention_days', 'notify_slack', 'notify_email', 'slack_api_base',
    'slack_channel', 'email_from', 'email_to', 'test_clock_enabled',
  ],
} as const;

// Which TypeScript file feeds which Code node, and how the node calls it.
export const CODE_NODES: Readonly<Record<keyof typeof WORKFLOW_FILES, Readonly<Record<string, CodeNodeSource>>>> = {
  capture: {
    'Read call status': {
      entry: 'src/nodes/readCallStatus.ts',
      wrapper: 'return [{ json: readCallStatus($input.first().json, $now.toISO()) }];',
    },
    'Decide': {
      entry: 'src/nodes/decideCall.ts',
      wrapper: "return [{ json: decideCall($input.first().json, $('Read call status').first().json, $('Config').first().json) }];",
    },
    'Release window': {
      entry: 'src/nodes/releaseWindow.ts',
      wrapper: 'return [{ json: releaseWindow($input.first().json, $now.toISO()) }];',
    },
    'Prepare SMS': {
      entry: 'src/nodes/prepareSms.ts',
      wrapper: "return prepareSms($input.all().map((item) => item.json), $('Config').first().json).map((json) => ({ json }));",
    },
    'Describe failure': {
      entry: 'src/nodes/describeFailure.ts',
      wrapper: "return $input.all().map((item, index) => ({ json: describeFailure(item.json, $('Prepare SMS').itemMatching(index).json) }));",
    },
    'Failure alert': {
      entry: 'src/nodes/failureAlert.ts',
      wrapper: "return failureAlert($input.all().map((item) => item.json), $('Config').first().json).map((json) => ({ json }));",
    },
  },
  replies: {
    'Read reply': {
      entry: 'src/nodes/readReply.ts',
      wrapper: 'return [{ json: readReply($input.first().json, $now.toISO()) }];',
    },
    'Decide reply': {
      entry: 'src/nodes/decideReply.ts',
      wrapper: "return [{ json: decideReply($input.first().json, $('Read reply').first().json, $('Config').first().json) }];",
    },
    'Describe link failure': {
      entry: 'src/nodes/describeLinkFailure.ts',
      wrapper: "return [{ json: describeLinkFailure($input.first().json, $('Decide reply').first().json) }];",
    },
    'Alert text': {
      entry: 'src/nodes/alertText.ts',
      wrapper: "return [{ json: alertText($input.first().json, $('Read reply').first().json, $('Config').first().json) }];",
    },
    'Read click': {
      entry: 'src/nodes/readClick.ts',
      wrapper: 'return [{ json: readClick($input.first().json, $now.toISO()) }];',
    },
  },
  report: {
    'Report window': {
      entry: 'src/nodes/reportWindow.ts',
      wrapper: 'return [{ json: reportWindowNode($input.first().json, $now.toISO()) }];',
    },
    'Build report': {
      entry: 'src/nodes/buildReport.ts',
      wrapper: "return [{ json: buildReportNode($input.first().json, $('Report window').first().json, $('Config').first().json) }];",
    },
  },
};

// Which SQL file feeds which Postgres node.
export const SQL_NODES: Readonly<Record<keyof typeof WORKFLOW_FILES, Readonly<Record<string, string>>>> = {
  capture: {
    'Create tables': 'schema.sql',
    'Claim call': 'claim-missed-call.sql',
    'Mark queued': 'set-call-outcome.sql',
    'Mark not texted': 'set-call-outcome.sql',
    'Claim due texts': 'claim-due-texts.sql',
    'Mark sent': 'set-call-outcome.sql',
    'Mark failed': 'set-call-outcome.sql',
  },
  replies: {
    'Record reply': 'record-reply.sql',
    'Save reply action': 'set-reply-action.sql',
    'Mark link failed': 'set-reply-action.sql',
    'Record click': 'record-click.sql',
  },
  report: {
    'Load day': 'daily-report.sql',
    'Apply retention': 'retention.sql',
  },
};

export const readSql = (file: string): string => readFileSync(resolve(REPO_ROOT, 'sql', file), 'utf8').trim();

const configFields = (config: KitConfig, keys: readonly string[]): Record<string, SetValue> => {
  const fields: Record<string, SetValue> = {};
  for (const key of keys) {
    const value = config[key];
    if (value === undefined) {
      throw new Error(`The config file is missing "${key}"`);
    }
    fields[key] = value;
  }
  return fields;
};

const code = (draft: WorkflowDraft, kind: keyof typeof WORKFLOW_FILES, name: string, position: Position): string => {
  const source = CODE_NODES[kind][name];
  if (!source) {
    throw new Error(`No TypeScript source registered for Code node "${name}"`);
  }
  return addNode(draft, codeNode(name, position, generateCodeNode(source), `Generated from ${source.entry}`));
};

const sql = (
  draft: WorkflowDraft,
  kind: keyof typeof WORKFLOW_FILES,
  name: string,
  position: Position,
  parameters: string,
  options: { independent?: boolean; continueOnFail?: boolean } = {},
): string => {
  const file = SQL_NODES[kind][name];
  if (!file) {
    throw new Error(`No SQL file registered for Postgres node "${name}"`);
  }
  return addNode(draft, postgresNode(name, position, readSql(file), parameters, options));
};

// Slack then email, in a straight line, so each alert is sent once per item.
// Every step reads the alert from the "Slack on?" node, which sees every item.
const alertChain = (draft: WorkflowDraft, from: string, x: number, y: number, suffix = ''): string => {
  const slackOn = addNode(draft, ifNode(`Slack on?${suffix}`, [x, y], isTrue(draft.id, `slack${suffix}`, "={{ $('Config').first().json.notify_slack }}")));
  const postSlack = addNode(draft, slackPostNode(`Post to Slack${suffix}`, [x + 220, y - 100], `={{ $('Slack on?${suffix}').item.json.alert_text }}`));
  const emailOn = addNode(draft, ifNode(`Email on?${suffix}`, [x + 440, y], isTrue(draft.id, `email${suffix}`, "={{ $('Config').first().json.notify_email }}")));
  const sendEmail = addNode(draft, emailNode(
    `Send email${suffix}`,
    [x + 660, y - 100],
    `={{ $('Slack on?${suffix}').item.json.alert_subject }}`,
    `={{ $('Slack on?${suffix}').item.json.alert_text }}`,
  ));
  connect(draft, from, slackOn);
  connect(draft, slackOn, postSlack, 0);
  connect(draft, slackOn, emailOn, 1);
  connect(draft, postSlack, emailOn);
  connect(draft, emailOn, sendEmail, 0);
  return emailOn;
};

const CAPTURE_NOTE = `## 1. Missed call capture
Twilio posts here when a forwarded call ends as **no-answer**, **busy** or **failed**.

1. **Read call status** turns the caller number into E.164.
2. **Claim call** stores the call in Postgres. The key is ParentCallSid (or CallSid), so a retried or duplicate callback never sends a second text.
3. **Decide** skips opted out numbers, withheld caller IDs, foreign numbers and repeat callers.
4. Between **quiet_start and quiet_end** (21:00 to 08:00) the text waits in the queue. The 15 minute schedule sends it from 08:00.
5. **Send SMS via Twilio** sends one text with a tracked booking link. If Twilio refuses it, the row is marked failed and the manager is alerted. There is no automatic resend, because a timed out request may already have gone out.

Code nodes are generated from TypeScript in \`src/\`. Edit there, run \`npm run build\`, re-import.`;

const SETUP_NOTE = `## Setup
**Credentials** (create once, reuse in all three workflows)
- Missed call kit Postgres
- Twilio API: Basic Auth. User is your Account SID, password is your Auth Token
- Missed call kit webhook login: Basic Auth, any user name and a long random password
- Slack bot token: Header Auth, name \`Authorization\`, value \`Bearer\` plus your bot token
- Manager email (SMTP), only if notify_email is on

**Config node**: business name, Twilio number, Account SID and the tracked link base (your n8n URL plus /webhook/hs/book).

**Run once: create tables** creates the Postgres tables.

**Twilio**: dial your shop phone from a TwiML Bin and send the status callback here. Put the webhook login in the URL:
\`https://USER:PASSWORD@your-n8n/webhook/hs/missed-call\``;

const POPIA_NOTE = `## POPIA
- The opt out list is checked at every send, including texts released at 08:00.
- No texts in quiet hours. They wait until quiet_end.
- Customer message text is never stored.
- Workflow 3 deletes rows older than retention_days. Opt outs are kept, so nobody is texted again.`;

export const buildCaptureWorkflow = (config: KitConfig): N8nWorkflow => {
  const kind = 'capture';
  const draft = createDraft(WORKFLOW_IDS.capture);
  addNode(draft, stickyNode('About this workflow', [-520, -260], CAPTURE_NOTE, { width: 500, height: 520, color: 4 }));
  addNode(draft, stickyNode('Setup', [-520, 300], SETUP_NOTE, { width: 500, height: 560, color: 6 }));
  addNode(draft, stickyNode('POPIA', [-520, 900], POPIA_NOTE, { width: 500, height: 240, color: 5 }));

  const statusHook = addNode(draft, webhookNode(draft.id, 'Twilio call status', [0, 200], {
    path: WEBHOOK_PATHS.missedCall, method: 'POST', auth: true, responseMode: 'lastNode', responseData: 'noData',
  }));
  const schedule = addNode(draft, scheduleNode('Every 15 min, 08:00 to 20:45', [0, 520], '*/15 8-20 * * *'));
  const releaseHook = addNode(draft, webhookNode(draft.id, 'Release queue now', [0, 700], {
    path: WEBHOOK_PATHS.releaseQueue, method: 'POST', auth: true, responseMode: 'lastNode', responseData: 'noData',
  }));
  const pathCall = addNode(draft, setNode(draft.id, 'Path: call status', [220, 200], { route: 'call_status' }, { keepInput: true }));
  const pathRelease = addNode(draft, setNode(draft.id, 'Path: release queue', [220, 600], { route: 'release' }, { keepInput: true }));
  const configNode = addNode(draft, setNode(draft.id, 'Config', [440, 400], configFields(config, CONFIG_KEYS.capture), { keepInput: true }));
  const route = addNode(draft, switchNode('Route', [660, 400], [
    { key: 'call status', conditions: stringEquals(draft.id, 'route-call', '={{ $json.route }}', ['call_status']) },
    { key: 'release queue', conditions: stringEquals(draft.id, 'route-release', '={{ $json.route }}', ['release']) },
  ]));

  const read = code(draft, kind, 'Read call status', [880, 200]);
  const missed = addNode(draft, ifNode('Missed call?', [1100, 200], isTrue(draft.id, 'missed', '={{ $json.is_missed }}')));
  const claim = sql(draft, kind, 'Claim call', [1320, 180],
    '={{ [ $json.call_key, $json.call_sid, $json.caller_e164 ?? null, $json.call_status, $json.called_at, $json.now_iso ] }}');
  const decide = code(draft, kind, 'Decide', [1540, 180]);
  const action = addNode(draft, switchNode('Action', [1760, 180], [
    { key: 'send', conditions: stringEquals(draft.id, 'action-send', '={{ $json.action }}', ['send']) },
    { key: 'queue', conditions: stringEquals(draft.id, 'action-queue', '={{ $json.action }}', ['queue']) },
    { key: 'not texted', conditions: stringEquals(draft.id, 'action-skip', '={{ $json.action }}', ['skip']) },
    { key: 'duplicate', conditions: stringEquals(draft.id, 'action-duplicate', '={{ $json.action }}', ['duplicate']) },
  ]));
  const markQueued = sql(draft, kind, 'Mark queued', [2000, 320],
    "={{ [ $json.call_key, 'queued', $json.send_after, null, null, null ] }}");
  const markSkipped = sql(draft, kind, 'Mark not texted', [2000, 480],
    '={{ [ $json.call_key, $json.outcome, null, null, null, null ] }}');

  const releaseWin = code(draft, kind, 'Release window', [880, 600]);
  const outside = addNode(draft, ifNode('Outside quiet hours?', [1100, 600], isTrue(draft.id, 'release', '={{ $json.release }}')));
  const claimDue = sql(draft, kind, 'Claim due texts', [1320, 600], '={{ [ $json.now_iso, $json.stale_before ] }}');

  const prepare = code(draft, kind, 'Prepare SMS', [2000, 20]);
  const send = addNode(draft, httpFormPostNode('Send SMS via Twilio', [2220, 20], '={{ $json.twilio_messages_url }}', {
    To: '={{ $json.sms_to }}',
    From: '={{ $json.sms_from }}',
    Body: '={{ $json.sms_body }}',
  }));
  const markSent = sql(draft, kind, 'Mark sent', [2440, -80],
    "={{ [ $('Prepare SMS').item.json.call_key, 'sent', null, $('Prepare SMS').item.json.now_iso, $json.sid ?? null, null ] }}",
    { independent: true });
  const describe = code(draft, kind, 'Describe failure', [2440, 120]);
  const markFailed = sql(draft, kind, 'Mark failed', [2660, 120],
    "={{ [ $json.call_key, 'failed', null, null, null, $json.error_text ] }}", { independent: true });
  const failure = code(draft, kind, 'Failure alert', [2880, 120]);

  const trigger = addNode(draft, manualTriggerNode('Run once: create tables', [0, 1000]));
  const createTables = sql(draft, kind, 'Create tables', [220, 1000], '');

  connect(draft, statusHook, pathCall);
  connect(draft, schedule, pathRelease);
  connect(draft, releaseHook, pathRelease);
  connect(draft, pathCall, configNode);
  connect(draft, pathRelease, configNode);
  connect(draft, configNode, route);
  connect(draft, route, read, 0);
  connect(draft, route, releaseWin, 1);
  connect(draft, read, missed);
  connect(draft, missed, claim, 0);
  connect(draft, claim, decide);
  connect(draft, decide, action);
  connect(draft, action, prepare, 0);
  connect(draft, action, markQueued, 1);
  connect(draft, action, markSkipped, 2);
  connect(draft, releaseWin, outside);
  connect(draft, outside, claimDue, 0);
  connect(draft, claimDue, prepare);
  connect(draft, prepare, send);
  connect(draft, send, markSent, 0);
  connect(draft, send, describe, 1);
  connect(draft, describe, markFailed);
  connect(draft, markFailed, failure);
  alertChain(draft, failure, 3100, 120);
  connect(draft, trigger, createTables);

  return finishWorkflow(draft, 'Missed call recovery 1: capture and text back', String(config.timezone));
};

const REPLIES_NOTE = `## 2. Replies and booking link clicks
**SMS reply** (Twilio Messaging, "A message comes in"):
- **STOP**, **UNSUBSCRIBE** or **OPT OUT** anywhere in the text, or CANCEL, END or QUIT as the whole text: the number goes on the opt out list. No more texts, not even a confirmation.
- **YES** or **BOOK**: the booking link goes back, with the same tracked link. An opted out number is never texted; the manager is told instead.
- Anything else: the manager gets the message in Slack or email.

MessageSid is the idempotency key, so a retried webhook does nothing twice.

**Link click** (GET /webhook/hs/book?t=...): records the first tap for the daily report, then redirects to booking_url. Link preview bots get a 403 and are not counted.`;

export const buildRepliesWorkflow = (config: KitConfig): N8nWorkflow => {
  const kind = 'replies';
  const draft = createDraft(WORKFLOW_IDS.replies);
  addNode(draft, stickyNode('About this workflow', [-520, -200], REPLIES_NOTE, { width: 500, height: 560, color: 4 }));

  const smsHook = addNode(draft, webhookNode(draft.id, 'Twilio inbound SMS', [0, 200], {
    path: WEBHOOK_PATHS.smsReply, method: 'POST', auth: true, responseMode: 'responseNode',
  }));
  const clickHook = addNode(draft, webhookNode(draft.id, 'Booking link click', [0, 700], {
    path: WEBHOOK_PATHS.bookingClick, method: 'GET', auth: false, responseMode: 'responseNode', ignoreBots: true,
  }));
  const pathReply = addNode(draft, setNode(draft.id, 'Path: SMS reply', [220, 200], { route: 'reply' }, { keepInput: true }));
  const pathClick = addNode(draft, setNode(draft.id, 'Path: link click', [220, 700], { route: 'click' }, { keepInput: true }));
  const configNode = addNode(draft, setNode(draft.id, 'Config', [440, 440], configFields(config, CONFIG_KEYS.replies), { keepInput: true }));
  const route = addNode(draft, switchNode('Route', [660, 440], [
    { key: 'SMS reply', conditions: stringEquals(draft.id, 'route-reply', '={{ $json.route }}', ['reply']) },
    { key: 'link click', conditions: stringEquals(draft.id, 'route-click', '={{ $json.route }}', ['click']) },
  ]));

  const read = code(draft, kind, 'Read reply', [880, 200]);
  const valid = addNode(draft, ifNode('Valid reply?', [1100, 200], isTrue(draft.id, 'valid', '={{ $json.valid }}')));
  const record = sql(draft, kind, 'Record reply', [1320, 180], '={{ [ $json.message_sid, $json.from_e164, $json.intent, $json.now_iso ] }}');
  const decide = code(draft, kind, 'Decide reply', [1540, 180]);
  const isNew = addNode(draft, ifNode('New reply?', [1760, 180], isTrue(draft.id, 'new', '={{ $json.is_new }}')));
  const save = sql(draft, kind, 'Save reply action', [1980, 160], '={{ [ $json.message_sid, $json.action, null ] }}');
  const replyAction = addNode(draft, switchNode('Reply action', [2200, 160], [
    { key: 'send link', conditions: stringEquals(draft.id, 'reply-link', '={{ $json.action }}', ['link_sent']) },
    { key: 'alert manager', conditions: stringEquals(draft.id, 'reply-alert', '={{ $json.action }}', ['manager_alerted', 'blocked_opted_out']) },
  ], 'opted out'));
  const sendLink = addNode(draft, httpFormPostNode('Send booking link', [2420, 0], "={{ $('Decide reply').first().json.twilio_messages_url }}", {
    To: "={{ $('Decide reply').first().json.sms_to }}",
    From: "={{ $('Decide reply').first().json.sms_from }}",
    Body: "={{ $('Decide reply').first().json.sms_body }}",
  }));
  const describe = code(draft, kind, 'Describe link failure', [2640, 60]);
  const markFailed = sql(draft, kind, 'Mark link failed', [2860, 60], "={{ [ $json.message_sid, 'link_failed', $json.error_text ] }}");
  const alert = code(draft, kind, 'Alert text', [3080, 240]);
  const respond = addNode(draft, respondTextNode('Reply to Twilio', [4200, 400],
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 'text/xml'));

  const readClickNode = code(draft, kind, 'Read click', [880, 700]);
  const recordClick = sql(draft, kind, 'Record click', [1100, 700], '={{ [ $json.token, $json.now_iso ] }}', { continueOnFail: true });
  const redirect = addNode(draft, respondRedirectNode('Redirect to booking page', [1320, 700], "={{ $('Config').first().json.booking_url }}"));

  connect(draft, smsHook, pathReply);
  connect(draft, clickHook, pathClick);
  connect(draft, pathReply, configNode);
  connect(draft, pathClick, configNode);
  connect(draft, configNode, route);
  connect(draft, route, read, 0);
  connect(draft, route, readClickNode, 1);
  connect(draft, read, valid);
  connect(draft, valid, record, 0);
  connect(draft, valid, respond, 1);
  connect(draft, record, decide);
  connect(draft, decide, isNew);
  connect(draft, isNew, save, 0);
  connect(draft, isNew, respond, 1);
  connect(draft, save, replyAction);
  connect(draft, replyAction, sendLink, 0);
  connect(draft, replyAction, alert, 1);
  connect(draft, replyAction, respond, 2);
  connect(draft, sendLink, respond, 0);
  connect(draft, sendLink, describe, 1);
  connect(draft, describe, markFailed);
  connect(draft, markFailed, alert);
  const end = alertChain(draft, alert, 3300, 240);
  connect(draft, end, respond, 1);
  connect(draft, 'Send email', respond);
  connect(draft, readClickNode, recordClick);
  connect(draft, recordClick, redirect);

  return finishWorkflow(draft, 'Missed call recovery 2: replies and link clicks', String(config.timezone));
};

const REPORT_NOTE = `## 3. Daily report at 08:00
Counts yesterday in the business timezone: missed calls, texts sent, replies, bookings clicked and opt outs. It also shows what waited for quiet hours, what was not texted and why, failed sends and duplicate callbacks.

Counts only. No names or numbers, so it is safe for Slack and email.

After the report, rows older than retention_days are deleted (POPIA). Opt outs are kept.

**Run report now**: POST {"date": "2026-10-16"} with the webhook login to get the same report back as JSON.`;

export const buildReportWorkflow = (config: KitConfig): N8nWorkflow => {
  const kind = 'report';
  const draft = createDraft(WORKFLOW_IDS.report);
  addNode(draft, stickyNode('About this workflow', [-520, -140], REPORT_NOTE, { width: 480, height: 440, color: 4 }));

  const schedule = addNode(draft, scheduleNode('Every day at 08:00', [0, 100], '0 8 * * *'));
  const hook = addNode(draft, webhookNode(draft.id, 'Run report now', [0, 300], {
    path: WEBHOOK_PATHS.dailyReport, method: 'POST', auth: true, responseMode: 'lastNode', responseData: 'firstEntryJson',
  }));
  const configNode = addNode(draft, setNode(draft.id, 'Config', [220, 200], configFields(config, CONFIG_KEYS.report), { keepInput: true }));
  const window = code(draft, kind, 'Report window', [440, 200]);
  const load = sql(draft, kind, 'Load day', [660, 200], '={{ [ $json.start_iso, $json.end_iso ] }}');
  const build = code(draft, kind, 'Build report', [880, 200]);
  const retention = sql(draft, kind, 'Apply retention', [2000, 200],
    "={{ [ $('Report window').first().json.retention_before ] }}", { continueOnFail: true });
  const done = addNode(draft, setNode(draft.id, 'Report done', [2220, 200], {
    report: "={{ $('Build report').first().json }}",
    retention: "={{ $('Apply retention').first().json }}",
  }, { keepInput: false, objectFields: ['report', 'retention'] }));

  connect(draft, schedule, configNode);
  connect(draft, hook, configNode);
  connect(draft, configNode, window);
  connect(draft, window, load);
  connect(draft, load, build);
  const end = alertChain(draft, build, 1100, 200);
  connect(draft, end, retention, 1);
  connect(draft, 'Send email', retention);
  connect(draft, retention, done);

  return finishWorkflow(draft, 'Missed call recovery 3: daily report', String(config.timezone));
};

export const buildAllWorkflows = (config: KitConfig): Record<string, N8nWorkflow> => ({
  [WORKFLOW_FILES.capture]: buildCaptureWorkflow(config),
  [WORKFLOW_FILES.replies]: buildRepliesWorkflow(config),
  [WORKFLOW_FILES.report]: buildReportWorkflow(config),
});
