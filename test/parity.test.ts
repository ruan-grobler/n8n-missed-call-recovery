// Runs the generated JavaScript of every Code node in a sandbox with n8n style globals, and checks it
// returns exactly what the TypeScript returns. Proves the code in the JSON runs and behaves the same.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { N8nWorkflow } from '../src/build/n8n.ts';
import { WORKFLOW_FILES } from '../src/build/workflows.ts';
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
import { TOKEN_A, TOKEN_B } from './fixtures.ts';

type Json = Record<string, unknown>;

const root = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('config/e2e.json', root), 'utf8')) as Json;
const NOW = '2026-10-21T10:00:00.000+02:00';
const workflows = Object.fromEntries(Object.entries(WORKFLOW_FILES).map(([kind, file]) =>
  [kind, JSON.parse(readFileSync(new URL(`workflows/${file}`, root), 'utf8')) as N8nWorkflow]));

const jsCodeOf = (kind: string, name: string): string => {
  const node = workflows[kind]?.nodes.find((candidate) => candidate.name === name);
  if (!node || typeof node.parameters.jsCode !== 'string') {
    throw new Error(`No Code node ${name} in ${kind}`);
  }
  return node.parameters.jsCode;
};

// The same globals n8n gives a "Run Once for All Items" Code node.
const runCodeNode = async (kind: string, name: string, input: Json[], nodes: Record<string, Json[]> = {}): Promise<Json[]> => {
  const wrap = (items: Json[]): { json: Json }[] => items.map((json) => ({ json }));
  type Items = { json: Json }[];
  type NodeProxy = { first: () => Items[number] | undefined; all: () => Items; itemMatching: (index: number) => Items[number] | undefined };
  const sandbox = {
    $input: { all: (): Items => wrap(input), first: (): Items[number] | undefined => wrap(input)[0] },
    $: (nodeName: string): NodeProxy => {
      const items = wrap(nodes[nodeName] ?? []);
      return { first: () => items[0], all: () => items, itemMatching: (index: number) => items[index] };
    },
    $now: DateTime.fromISO(NOW),
    DateTime,
  };
  const result = await (runInNewContext(`(async () => {\n${jsCodeOf(kind, name)}\n})()`, sandbox) as Promise<{ json: Json }[]>);
  return JSON.parse(JSON.stringify(result.map((item) => item.json))) as Json[];
};

const same = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const callItem = { headers: { 'x-hs-test-clock': '2026-10-16T22:10:00+02:00' }, body: { CallSid: 'CA1', From: '0000000002', CallStatus: 'busy' }, route: 'call_status', ...config };
const replyItem = { headers: { 'x-hs-test-clock': '2026-10-16T12:40:00+02:00' }, body: { MessageSid: 'SM1', From: '+27000000011', Body: 'yes please' }, route: 'reply', ...config };

describe('generated Code nodes behave exactly like the TypeScript', () => {
  it('Read call status', async () => {
    expect(await runCodeNode('capture', 'Read call status', [callItem])).toEqual([same(readCallStatus(callItem, NOW))]);
  });

  it('Decide', async () => {
    const call = readCallStatus(callItem, NOW);
    const claim = { call_key: 'CA1', caller_e164: '+27000000002', link_token: TOKEN_A, callback_count: 1, opted_out: false, last_sent_at: null, has_queued: false };
    const out = await runCodeNode('capture', 'Decide', [claim], { 'Read call status': [{ ...call }], 'Config': [config] });
    expect(out).toEqual([same(decideCall(claim, { ...call }, config))]);
    expect(out[0]?.action).toBe('queue');
  });

  it('Release window', async () => {
    const item = { headers: { 'x-hs-test-clock': '2026-10-17T08:00:00+02:00' }, route: 'release', ...config };
    expect(await runCodeNode('capture', 'Release window', [item])).toEqual([same(releaseWindow(item, NOW))]);
  });

  it('Prepare SMS', async () => {
    const inputs = [
      { action: 'send', call_key: 'CA1', caller_e164: '+27000000001', link_token: TOKEN_A, now_iso: 'NOW' },
      { success: true },
      { outcome: 'sending', call_key: 'CA2', caller_e164: '+27000000002', link_token: TOKEN_B, now_iso: 'NOW' },
    ];
    const out = await runCodeNode('capture', 'Prepare SMS', inputs, { Config: [config] });
    expect(out).toEqual(same(prepareSms(inputs, config)));
    expect(out).toHaveLength(2);
  });

  it('Describe failure and Failure alert', async () => {
    const errorItem = { error: { message: '400 - "{\\"code\\":21614,\\"message\\":\\"Nope\\"}"' } };
    const prepared = { call_key: 'CA1', sms_to: '+27000000035' };
    expect(await runCodeNode('capture', 'Describe failure', [errorItem], { 'Prepare SMS': [prepared] }))
      .toEqual([same(describeFailure(errorItem, prepared))]);
    const rows = [{ call_key: 'CA1', outcome: 'failed', caller_e164: '+27000000035', called_at: '2026-10-16T17:12:00.000Z', last_error: 'Nope' }];
    expect(await runCodeNode('capture', 'Failure alert', rows, { Config: [config] })).toEqual(same(failureAlert(rows, config)));
  });

  it('Read reply, Decide reply and Alert text', async () => {
    const reply = readReply(replyItem, NOW);
    expect(await runCodeNode('replies', 'Read reply', [replyItem])).toEqual([same(reply)]);
    const row = { is_new: true, opted_out_before: false, opted_out_now: false, link_token: TOKEN_A };
    expect(await runCodeNode('replies', 'Decide reply', [row], { 'Read reply': [{ ...reply }], 'Config': [config] }))
      .toEqual([same(decideReply(row, { ...reply }, config))]);
    const saved = { message_sid: 'SM1', from_e164: '+27000000011', action: 'manager_alerted', detail: null };
    expect(await runCodeNode('replies', 'Alert text', [saved], { 'Read reply': [{ ...reply }], 'Config': [config] }))
      .toEqual([same(alertText(saved, { ...reply }, config))]);
  });

  it('Describe link failure and Read click', async () => {
    const errorItem = { error: { message: 'socket hang up' } };
    const decision = { message_sid: 'SM1' };
    expect(await runCodeNode('replies', 'Describe link failure', [errorItem], { 'Decide reply': [decision] }))
      .toEqual([same(describeLinkFailure(errorItem, decision))]);
    const click = { query: { t: TOKEN_A }, headers: {}, route: 'click', ...config };
    expect(await runCodeNode('replies', 'Read click', [click])).toEqual([same(readClick(click, NOW))]);
  });

  it('Report window and Build report', async () => {
    const trigger = { headers: { 'x-hs-test-clock': '2026-10-17T08:00:00+02:00' }, body: { date: '2026-10-16' }, ...config };
    const window = reportWindowNode(trigger, NOW);
    expect(await runCodeNode('report', 'Report window', [trigger])).toEqual([same(window)]);
    const row = {
      calls: [{ outcome: 'queued', called_at: '2026-10-16T20:10:00+00:00', sent_at: null, send_after: '2026-10-17T06:00:00+00:00', clicked_at: null, callback_count: 2 }],
      replies: [{ intent: 'opt_out', action: 'opted_out', received_at: '2026-10-16T11:02:00+00:00' }],
      opt_outs: 1,
    };
    const out = await runCodeNode('report', 'Build report', [row], { 'Report window': [{ ...window }], 'Config': [config] });
    expect(out).toEqual([same(buildReportNode(row, { ...window }, config))]);
    expect(out[0]?.counts).toMatchObject({ missedCalls: 1, heldForMorning: 1, duplicateCallbacks: 1, optOuts: 1 });
  });
});
