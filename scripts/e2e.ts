// npm run e2e: starts n8n 2.44.5, Postgres and the mock APIs in Docker, imports and publishes the three
// workflows, replays the synthetic day through the real webhooks and checks the answer key.
// It also replays the same day in-process and checks both runs agree. Output: docs/e2e-output.txt.
// Flags: --keep leaves the stack running for a look around (http://localhost:15678).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../src/build/codegen.ts';
import { WEBHOOK_PATHS } from '../src/build/workflows.ts';
import type { KitConfig } from '../src/build/workflows.ts';
import { formatResult } from '../src/sim/format.ts';
import { PHONE_AGENT, runScenario } from '../src/sim/runner.ts';
import type { Check, ScenarioResult } from '../src/sim/runner.ts';
import { createSimDriver } from '../src/sim/simDriver.ts';
import { createN8nDriver } from './e2e/n8nDriver.ts';
import { dockerAvailable, newSecrets, stackDown, stackUp } from './e2e/stack.ts';
import type { StackPorts, StackSecrets } from './e2e/stack.ts';

const PORTS: StackPorts = { n8n: 15678, mockTwilio: 14010, mockSinks: 14020 };

const waitForWebhooks = async (): Promise<void> => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      // A phone user agent, because the click webhook ignores bots (and Node's default "node" agent).
      const response = await fetch(`http://127.0.0.1:${PORTS.n8n}/webhook/${WEBHOOK_PATHS.bookingClick}?t=ffffffffffff`, {
        redirect: 'manual',
        headers: { 'user-agent': PHONE_AGENT },
      });
      if (response.status === 302) {
        return;
      }
    } catch {
      // n8n is still starting
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error('n8n webhooks did not come up within 2 minutes');
};

// Checks that only make sense against real n8n.
const securityChecks = async (secrets: StackSecrets): Promise<Check[]> => {
  const base = `http://127.0.0.1:${PORTS.n8n}/webhook`;
  const noAuth = await fetch(`${base}/${WEBHOOK_PATHS.missedCall}`, { method: 'POST', body: new URLSearchParams({ CallSid: 'CAnoauth' }) });
  const wrong = await fetch(`${base}/${WEBHOOK_PATHS.missedCall}`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${secrets.webhookUser}:wrong-password`).toString('base64')}` },
    body: new URLSearchParams({ CallSid: 'CAwrongauth' }),
  });
  const challenge = noAuth.headers.get('www-authenticate') ?? '';
  return [
    {
      name: 'Webhooks refuse callers without the login (Twilio retries with it after the challenge)',
      passed: noAuth.status === 401 && wrong.status === 401 && challenge.startsWith('Basic'),
      detail: `no login: ${noAuth.status} with "${challenge}", wrong password: ${wrong.status}`,
    },
  ];
};

const agreement = (n8n: ScenarioResult, sim: ScenarioResult): Check[] => {
  const outcomes = (result: ScenarioResult): string => result.callRows.map((row) => `${row.call_key}:${row.outcome}`).sort().join(',');
  return [
    {
      name: 'n8n and the in-process demo produce the same report',
      passed: n8n.report.text === sim.report.text,
      detail: n8n.report.text === sim.report.text ? 'report text is identical' : 'report text differs',
    },
    {
      name: 'n8n and the in-process demo agree on every call outcome',
      passed: outcomes(n8n) === outcomes(sim),
      detail: outcomes(n8n) === outcomes(sim) ? `${n8n.callRows.length} outcomes identical` : 'outcomes differ',
    },
  ];
};

const main = async (): Promise<void> => {
  if (!dockerAvailable()) {
    console.error('Docker is not running, so the e2e run was skipped. Start Docker Desktop and run "npm run e2e" again.');
    process.exit(2);
  }
  const keep = process.argv.includes('--keep');
  const secrets = newSecrets();
  const started = Date.now();
  try {
    console.log('Starting n8n 2.44.5, Postgres 17 and the mocks in Docker...');
    stackUp(secrets, PORTS);
    await waitForWebhooks();
    const bootSeconds = Math.round((Date.now() - started) / 1000);
    console.log(`Stack ready in ${bootSeconds}s. Replaying the synthetic day through n8n...`);

    const replayStarted = Date.now();
    const n8nResult = await runScenario(createN8nDriver(secrets, PORTS));
    const replaySeconds = Math.round((Date.now() - replayStarted) / 1000);
    n8nResult.checks.push(...await securityChecks(secrets));

    const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'config/e2e.json'), 'utf8')) as KitConfig;
    const sim = await createSimDriver(config);
    const simResult = await runScenario(sim.driver);
    await sim.close();
    n8nResult.checks.push(...agreement(n8nResult, simResult));

    const output = [
      formatResult('Missed call recovery kit: end to end run in real n8n (synthetic data)', n8nResult),
      'Stack: n8n 2.44.5, Postgres 17, mock Twilio, mock Slack and SMTP sink, all in Docker on this machine.',
      `Stack start ${bootSeconds}s, replay of ${n8nResult.requests} events ${replaySeconds}s.`,
      '',
    ].join('\n');
    console.log(output);
    writeFileSync(resolve(REPO_ROOT, 'docs/e2e-output.txt'), output);
    console.log('Saved to docs/e2e-output.txt');
    if (n8nResult.checks.some((check) => !check.passed)) {
      process.exitCode = 1;
    }
  } finally {
    if (keep) {
      console.log(`Stack left running. n8n: http://localhost:${PORTS.n8n}. Stop it with: KIT_DB_PASSWORD=x KIT_N8N_ENCRYPTION_KEY=x docker compose -p missed-call-kit-e2e down -v`);
    } else {
      stackDown(secrets, PORTS);
      console.log('Stack stopped and removed.');
    }
  }
};

await main();
