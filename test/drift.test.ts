// Fails if workflows/*.json drifts from the TypeScript, SQL and config that generate it.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderWorkflows } from '../scripts/build.ts';
import { generateCodeNode } from '../src/build/codegen.ts';
import { findDrift } from '../src/build/drift.ts';
import { CREDENTIALS, timeSavedNode } from '../src/build/n8n.ts';
import type { N8nNode, N8nWorkflow } from '../src/build/n8n.ts';
import { CODE_NODES, SQL_NODES, TIME_SAVED_MINUTES, WORKFLOW_FILES, buildAllWorkflows, readSql } from '../src/build/workflows.ts';
import type { KitConfig } from '../src/build/workflows.ts';

const root = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('config/default.json', root), 'utf8')) as KitConfig;
const committed = (file: string): N8nWorkflow => JSON.parse(readFileSync(new URL(`workflows/${file}`, root), 'utf8')) as N8nWorkflow;
const kinds = Object.keys(WORKFLOW_FILES) as (keyof typeof WORKFLOW_FILES)[];

describe('workflows/*.json is in sync with the source', () => {
  it('matches a fresh build byte for byte', () => {
    const rendered = renderWorkflows(new URL('config/default.json', root).pathname);
    expect(Object.keys(rendered).sort()).toEqual(readdirSync(new URL('workflows/', root)).sort());
    for (const [file, json] of Object.entries(rendered)) {
      expect(readFileSync(new URL(`workflows/${file}`, root), 'utf8'), `${file} is stale, run npm run build`).toBe(json);
    }
  });

  it.each(kinds)('every Code node in the %s workflow is generated from its TypeScript file', (kind) => {
    const workflow = committed(WORKFLOW_FILES[kind]);
    const codeNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.code');
    expect(codeNodes.map((node) => node.name).sort()).toEqual(Object.keys(CODE_NODES[kind]).sort());
    for (const node of codeNodes) {
      const source = CODE_NODES[kind][node.name];
      expect(source, node.name).toBeDefined();
      expect(node.parameters.jsCode, `${node.name} drifted from ${source?.entry}`).toBe(generateCodeNode(source ?? { entry: '', wrapper: '' }));
    }
  });

  it.each(kinds)('every Postgres node in the %s workflow runs its SQL file unchanged', (kind) => {
    const workflow = committed(WORKFLOW_FILES[kind]);
    const sqlNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.postgres');
    expect(sqlNodes.map((node) => node.name).sort()).toEqual(Object.keys(SQL_NODES[kind]).sort());
    for (const node of sqlNodes) {
      expect(node.parameters.query, node.name).toBe(readSql(SQL_NODES[kind][node.name] ?? ''));
    }
  });

  it('reports a hand edit made in n8n, node by node', () => {
    const fresh = buildAllWorkflows(config)[WORKFLOW_FILES.capture] as N8nWorkflow;
    const edited = structuredClone(fresh);
    const decide = edited.nodes.find((node) => node.name === 'Decide');
    const claim = edited.nodes.find((node) => node.name === 'Claim call');
    if (!decide || !claim) {
      throw new Error('fixture nodes missing');
    }
    decide.parameters.jsCode = `${String(decide.parameters.jsCode)}\n// quick fix in the n8n editor`;
    claim.parameters.query = String(claim.parameters.query).replace('ON CONFLICT', 'ON  CONFLICT');
    edited.nodes.push({ ...decide, id: 'extra', name: 'Extra node' });
    edited.settings = { ...edited.settings, timezone: 'UTC' };
    edited.connections = {};
    expect(findDrift(edited, fresh)).toEqual([
      'Postgres node "Claim call" (postgres) no longer matches its SQL file',
      'Code node "Decide" (code) no longer matches its TypeScript source',
      'node "Extra node" (code) is in the JSON but not in src/build/workflows.ts',
      'the connections between nodes differ',
      'workflow name, id or settings differ',
    ]);
    const missing = structuredClone(fresh);
    missing.nodes = missing.nodes.filter((node) => node.name !== 'Config');
    expect(findDrift(missing, fresh)).toContain('node "Config" (set) is missing from the JSON');
    const retuned = structuredClone(fresh);
    const send = retuned.nodes.find((node) => node.name === 'Send SMS via Twilio');
    if (send) {
      send.retryOnFail = true;
    }
    expect(findDrift(retuned, fresh)).toEqual(['node "Send SMS via Twilio" (httpRequest) has different settings']);
    expect(findDrift(fresh, fresh)).toEqual([]);
  });
});

describe('the shipped workflows are safe to share', () => {
  const all = kinds.map((kind) => committed(WORKFLOW_FILES[kind]));

  it('ship with the test clock switched off and placeholder settings only', () => {
    for (const workflow of all) {
      const configNode = workflow.nodes.find((node) => node.name === 'Config');
      const assignments = (configNode?.parameters.assignments as { assignments: { name: string; value: unknown }[] }).assignments;
      const values = Object.fromEntries(assignments.map((field) => [field.name, field.value]));
      expect(values.test_clock_enabled).toBe(false);
      for (const [key, value] of Object.entries(values)) {
        expect(value, key).toEqual(config[key]);
      }
    }
  });

  it('reference credentials by placeholder only, never with secrets inside', () => {
    const known = Object.values(CREDENTIALS).map((credential) => credential.ref.id);
    for (const workflow of all) {
      for (const node of workflow.nodes) {
        for (const ref of Object.values(node.credentials ?? {})) {
          expect(known).toContain(ref.id);
          expect(Object.keys(ref).sort()).toEqual(['id', 'name']);
        }
      }
    }
  });

  it('do not save successful runs, so n8n keeps no copy of numbers and replies', () => {
    for (const workflow of all) {
      expect(workflow.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', timezone: 'Africa/Johannesburg' });
    }
  });

  it('never retry an SMS send automatically', () => {
    for (const workflow of all) {
      for (const node of workflow.nodes.filter((candidate) => candidate.parameters.genericAuthType === 'httpBasicAuth')) {
        expect(node.retryOnFail, node.name).toBeUndefined();
        expect(node.onError, node.name).toBe('continueErrorOutput');
      }
    }
  });

  it('protect every Twilio webhook with the webhook login and ignore bots on the link', () => {
    const hooks = all.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook'));
    const paths = hooks.map((node) => node.parameters.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const hook of hooks) {
      if (hook.parameters.path === 'hs/book') {
        expect(hook.parameters).toMatchObject({ authentication: 'none', options: { ignoreBots: true } });
      } else {
        expect(hook.parameters.authentication, String(hook.parameters.path)).toBe('basicAuth');
      }
    }
  });

  it('have no dangling connections and no unconnected working nodes', () => {
    for (const workflow of all) {
      const names = new Set(workflow.nodes.map((node) => node.name));
      const targets = new Set<string>();
      for (const [from, outputs] of Object.entries(workflow.connections)) {
        expect(names.has(from)).toBe(true);
        for (const connection of outputs.main.flat()) {
          expect(names.has(connection.node)).toBe(true);
          targets.add(connection.node);
        }
      }
      const loose = workflow.nodes.filter((node) => !/Trigger|webhook|stickyNote/i.test(node.type) && !targets.has(node.name));
      expect(loose.map((node) => node.name)).toEqual([]);
    }
  });
});

describe('every workflow records the time it saves in n8n Insights', () => {
  const all = kinds.map((kind) => committed(WORKFLOW_FILES[kind]));
  const savers = (workflow: N8nWorkflow): N8nNode[] => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.timeSaved');
  const fedBy = (workflow: N8nWorkflow, from: string, output: number): string[] =>
    (workflow.connections[from]?.main[output] ?? []).map((connection) => connection.node);
  const feeds = (workflow: N8nWorkflow, target: string): string[] =>
    Object.entries(workflow.connections).flatMap(([source, outputs]) => outputs.main.flatMap((connections, index) =>
      connections.some((connection) => connection.node === target) ? [`${source} output ${index}`] : []));
  const reachable = (workflow: N8nWorkflow, from: string, output: number): string[] => {
    const seen = new Set<string>();
    const queue = fedBy(workflow, from, output);
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      if (!seen.has(name)) {
        seen.add(name);
        queue.push(...(workflow.connections[name]?.main ?? []).flat().map((connection) => connection.node));
      }
    }
    return [...seen];
  };

  it('uses Dynamic time saved, so n8n adds up the Time saved nodes that ran', () => {
    for (const workflow of all) {
      expect(workflow.settings.timeSavedMode, workflow.name).toBe('dynamic');
      expect(savers(workflow).length, workflow.name).toBeGreaterThan(0);
    }
  });

  it('records each baseline once, right after the step that did the job', () => {
    const expected: [keyof typeof WORKFLOW_FILES, string, string, keyof typeof TIME_SAVED_MINUTES, 'once' | 'perItem'][] = [
      ['capture', 'Time saved: text sent', 'Mark sent output 0', 'missedCallText', 'perItem'],
      ['replies', 'Time saved: link sent again', 'Send booking link output 0', 'bookingLinkAgain', 'perItem'],
      ['replies', 'Time saved: booking click', 'First tap? output 0', 'bookingClick', 'perItem'],
      ['report', 'Time saved: daily report', 'Report done output 0', 'dailyReport', 'once'],
    ];
    const found = kinds.flatMap((kind) => savers(committed(WORKFLOW_FILES[kind])).map((node) => `${kind}: ${node.name}`));
    expect(found.sort()).toEqual(expected.map(([kind, name]) => `${kind}: ${name}`).sort());
    expect(expected.map(([, , , job]) => job).sort()).toEqual(Object.keys(TIME_SAVED_MINUTES).sort());
    for (const [kind, name, input, job, mode] of expected) {
      const workflow = committed(WORKFLOW_FILES[kind]);
      const node = workflow.nodes.find((candidate) => candidate.name === name);
      expect(node, name).toMatchObject({ typeVersion: 1, parameters: { mode, minutesSaved: TIME_SAVED_MINUTES[job] } });
      expect(Object.keys(node?.parameters ?? {}).sort(), name).toEqual(['minutesSaved', 'mode']);
      expect(feeds(workflow, name), name).toEqual([input]);
    }
  });

  it('never counts a failed send, a repeat tap or an unknown link', () => {
    for (const workflow of all) {
      const names = new Set(savers(workflow).map((node) => node.name));
      for (const node of workflow.nodes.filter((candidate) => candidate.onError === 'continueErrorOutput')) {
        expect(reachable(workflow, node.name, 1).filter((name) => names.has(name)), node.name).toEqual([]);
      }
    }
    const replies = committed(WORKFLOW_FILES.replies);
    const firstTap = replies.nodes.find((node) => node.name === 'First tap?');
    expect(JSON.stringify(firstTap?.parameters)).toContain('$json.first_tap === true');
    expect(feeds(replies, 'First tap?')).toEqual(['Redirect to booking page output 0']);
    expect(fedBy(replies, 'First tap?', 1)).toEqual([]);
  });

  it('refuses minutes n8n cannot record', () => {
    expect(timeSavedNode('Time saved: test', [0, 0], 4, 'once', '').parameters).toEqual({ mode: 'once', minutesSaved: 4 });
    expect(() => timeSavedNode('Time saved: test', [0, 0], 2.5, 'once', '')).toThrow(/whole number/);
    expect(() => timeSavedNode('Time saved: test', [0, 0], 0, 'perItem', '')).toThrow(/whole number/);
  });
});

describe('SQL files', () => {
  it('never end with a line comment, because n8n joins multi item queries with a semicolon', () => {
    for (const file of readdirSync(new URL('sql/', root))) {
      const lastLine = readSql(file).split('\n').at(-1) ?? '';
      expect(lastLine.trim().startsWith('--'), file).toBe(false);
      expect(readSql(file), file).not.toContain('{{');
    }
  });
});

describe('live mode build (--env)', () => {
  it('overrides settings from KIT_* variables and keeps their types', async () => {
    const { envOverrides } = await import('../scripts/build.ts');
    const merged = envOverrides(config, {
      KIT_BUSINESS_NAME: 'My Pizza Place', KIT_REPEAT_COOLDOWN_MINUTES: '120', KIT_NOTIFY_EMAIL: 'true', KIT_QUIET_START: '',
    });
    expect(merged).toMatchObject({ business_name: 'My Pizza Place', repeat_cooldown_minutes: 120, notify_email: true, quiet_start: '21:00' });
    expect(() => envOverrides(config, { KIT_STALE_AFTER_HOURS: 'soon' })).toThrow(/must be a number/);
    expect(() => envOverrides(config, { KIT_NOTIFY_SLACK: 'yes' })).toThrow(/true or false/);
  });
});
