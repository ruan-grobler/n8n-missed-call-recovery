// Small helpers that build n8n workflow JSON. Node versions are ones that exist in n8n 1.x and 2.x;
// the e2e run imports them into n8n 2.44.5.
import { createHash } from 'node:crypto';

export type Position = [number, number];

export interface CredentialRef {
  id: string;
  name: string;
}

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: Position;
  parameters: Record<string, unknown>;
  credentials?: Record<string, CredentialRef>;
  webhookId?: string;
  onError?: 'continueRegularOutput' | 'continueErrorOutput';
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  notes?: string;
  notesInFlow?: boolean;
}

export interface Connection {
  node: string;
  type: 'main';
  index: number;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: Connection[][] }>;
  settings: Record<string, unknown>;
  pinData: Record<string, never>;
  meta: Record<string, unknown>;
  active: false;
  tags: never[];
}

// Placeholder credentials. On import n8n shows these names; pick or create the real credential in the UI.
// The ids are fixed so the e2e run can create matching test credentials with the CLI.
export const CREDENTIALS = {
  postgres: { type: 'postgres', ref: { id: 'hsPostgresCred01', name: 'Missed call kit Postgres' } },
  twilioApi: { type: 'httpBasicAuth', ref: { id: 'hsTwilioApiCred1', name: 'Twilio API (Account SID and Auth Token)' } },
  webhookAuth: { type: 'httpBasicAuth', ref: { id: 'hsWebhookAuth001', name: 'Missed call kit webhook login' } },
  slack: { type: 'httpHeaderAuth', ref: { id: 'hsSlackBotCred01', name: 'Slack bot token (Authorization header)' } },
  smtp: { type: 'smtp', ref: { id: 'hsSmtpCred000001', name: 'Manager email (SMTP)' } },
} as const;

// Stable UUID shaped ids, so regenerating the JSON gives a clean diff.
export const stableId = (...parts: string[]): string => {
  const hex = createHash('sha1').update(parts.join('::')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export interface WorkflowDraft {
  id: string;
  nodes: N8nNode[];
  connections: N8nWorkflow['connections'];
}

export const createDraft = (id: string): WorkflowDraft => ({ id, nodes: [], connections: {} });

export const addNode = (draft: WorkflowDraft, node: Omit<N8nNode, 'id'>): string => {
  if (draft.nodes.some((existing) => existing.name === node.name)) {
    throw new Error(`Duplicate node name "${node.name}" in ${draft.id}`);
  }
  draft.nodes.push({ id: stableId(draft.id, node.name), ...node });
  return node.name;
};

// Connects output `fromIndex` of one node to the first input of another.
export const connect = (draft: WorkflowDraft, from: string, to: string, fromIndex = 0): void => {
  for (const name of [from, to]) {
    if (!draft.nodes.some((node) => node.name === name)) {
      throw new Error(`Unknown node "${name}" in ${draft.id}`);
    }
  }
  const outputs = draft.connections[from] ?? { main: [] };
  while (outputs.main.length <= fromIndex) {
    outputs.main.push([]);
  }
  outputs.main[fromIndex]?.push({ node: to, type: 'main', index: 0 });
  draft.connections[from] = outputs;
};

const condition = (draftId: string, key: string, leftValue: string, operator: Record<string, unknown>, rightValue: unknown = ''): Record<string, unknown> => ({
  id: stableId(draftId, key, leftValue, String(rightValue)),
  leftValue,
  rightValue,
  operator,
});

const filter = (conditions: Record<string, unknown>[], combinator: 'and' | 'or' = 'and'): Record<string, unknown> => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions,
  combinator,
});

export const isTrue = (draftId: string, key: string, expression: string): Record<string, unknown> =>
  filter([condition(draftId, key, expression, { type: 'boolean', operation: 'true', singleValue: true })]);

export const stringEquals = (draftId: string, key: string, expression: string, values: readonly string[]): Record<string, unknown> =>
  filter(values.map((value) => condition(draftId, key, expression, { type: 'string', operation: 'equals' }, value)), 'or');

// ---- node constructors ----

export const webhookNode = (
  draftId: string,
  name: string,
  position: Position,
  options: { path: string; method: 'GET' | 'POST'; auth: boolean; responseMode: 'lastNode' | 'responseNode'; responseData?: 'noData' | 'firstEntryJson'; ignoreBots?: boolean },
): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position,
  webhookId: stableId(draftId, 'webhook', options.path),
  parameters: {
    httpMethod: options.method,
    path: options.path,
    authentication: options.auth ? 'basicAuth' : 'none',
    responseMode: options.responseMode,
    ...(options.responseMode === 'lastNode' ? { responseData: options.responseData ?? 'noData' } : {}),
    options: options.ignoreBots ? { ignoreBots: true } : {},
  },
  ...(options.auth ? { credentials: { httpBasicAuth: CREDENTIALS.webhookAuth.ref } } : {}),
});

export const scheduleNode = (name: string, position: Position, cron: string): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.2,
  position,
  parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } },
});

export const manualTriggerNode = (name: string, position: Position): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position,
  parameters: {},
});

export type SetValue = string | number | boolean;

export const setNode = (
  draftId: string,
  name: string,
  position: Position,
  fields: Readonly<Record<string, SetValue>>,
  options: { keepInput: boolean; objectFields?: readonly string[] },
): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position,
  parameters: {
    mode: 'manual',
    assignments: {
      assignments: Object.entries(fields).map(([field, value]) => ({
        id: stableId(draftId, name, field),
        name: field,
        value,
        type: options.objectFields?.includes(field) ? 'object' : typeof value,
      })),
    },
    includeOtherFields: options.keepInput,
    ...(options.keepInput ? { include: 'all' } : {}),
    options: {},
  },
});

export const codeNode = (name: string, position: Position, jsCode: string, notes: string): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode },
  notes,
});

export const ifNode = (name: string, position: Position, conditions: Record<string, unknown>): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position,
  parameters: { conditions, looseTypeValidation: false, options: {} },
});

export const switchNode = (
  name: string,
  position: Position,
  rules: readonly { key: string; conditions: Record<string, unknown> }[],
  fallback?: string,
): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.switch',
  typeVersion: 3.2,
  position,
  parameters: {
    rules: { values: rules.map((rule) => ({ conditions: rule.conditions, renameOutput: true, outputKey: rule.key })) },
    looseTypeValidation: false,
    options: fallback ? { fallbackOutput: 'extra', renameFallbackOutput: fallback } : {},
  },
});

export const postgresNode = (
  name: string,
  position: Position,
  query: string,
  parameters: string,
  options: { independent?: boolean; continueOnFail?: boolean } = {},
): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.5,
  position,
  parameters: {
    operation: 'executeQuery',
    query,
    options: {
      ...(parameters !== '' ? { queryReplacement: parameters } : {}),
      ...(options.independent ? { queryBatching: 'independently' } : {}),
    },
  },
  credentials: { postgres: CREDENTIALS.postgres.ref },
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 1000,
  ...(options.continueOnFail ? { onError: 'continueRegularOutput' as const } : {}),
});

export const httpFormPostNode = (
  name: string,
  position: Position,
  url: string,
  body: Readonly<Record<string, string>>,
): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  parameters: {
    method: 'POST',
    url,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBasicAuth',
    sendBody: true,
    contentType: 'form-urlencoded',
    bodyParameters: { parameters: Object.entries(body).map(([key, value]) => ({ name: key, value })) },
    options: { timeout: 10000 },
  },
  credentials: { httpBasicAuth: CREDENTIALS.twilioApi.ref },
  // No automatic retry: a timed out SMS request may already have been sent, and a retry would double text.
  onError: 'continueErrorOutput',
});

export const slackPostNode = (name: string, position: Position, textExpression: string): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  parameters: {
    method: 'POST',
    url: "={{ $('Config').first().json.slack_api_base }}/api/chat.postMessage",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'keypair',
    bodyParameters: {
      parameters: [
        { name: 'channel', value: "={{ $('Config').first().json.slack_channel }}" },
        { name: 'text', value: textExpression },
      ],
    },
    options: { timeout: 10000 },
  },
  credentials: { httpHeaderAuth: CREDENTIALS.slack.ref },
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 2000,
  onError: 'continueRegularOutput',
});

export const emailNode = (name: string, position: Position, subjectExpression: string, textExpression: string): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.emailSend',
  typeVersion: 2.1,
  position,
  parameters: {
    fromEmail: "={{ $('Config').first().json.email_from }}",
    toEmail: "={{ $('Config').first().json.email_to }}",
    subject: subjectExpression,
    emailFormat: 'text',
    text: textExpression,
    options: { appendAttribution: false },
  },
  credentials: { smtp: CREDENTIALS.smtp.ref },
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 2000,
  onError: 'continueRegularOutput',
});

export const respondTextNode = (name: string, position: Position, body: string, contentType: string): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position,
  parameters: {
    respondWith: 'text',
    responseBody: body,
    options: { responseCode: 200, responseHeaders: { entries: [{ name: 'Content-Type', value: contentType }] } },
  },
});

export const respondRedirectNode = (name: string, position: Position, urlExpression: string): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position,
  parameters: { respondWith: 'redirect', redirectURL: urlExpression, options: { responseCode: 302 } },
});

export const stickyNode = (name: string, position: Position, content: string, size: { width: number; height: number; color?: number }): Omit<N8nNode, 'id'> => ({
  name,
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position,
  parameters: { content, width: size.width, height: size.height, color: size.color ?? 7 },
});

export const finishWorkflow = (draft: WorkflowDraft, name: string, timezone: string): N8nWorkflow => ({
  id: draft.id,
  name,
  nodes: draft.nodes,
  connections: draft.connections,
  // Successful runs are not saved: n8n's execution log would otherwise keep a copy of every phone number
  // and every SMS reply. Failed runs are kept so you can debug them (POPIA: keep only what you need).
  settings: {
    executionOrder: 'v1',
    timezone,
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'none',
    saveExecutionProgress: false,
    saveManualExecutions: true,
    callerPolicy: 'workflowsFromSameOwner',
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  active: false,
  tags: [],
});
