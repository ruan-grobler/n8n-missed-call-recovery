// npm run demo: replays the synthetic Harbour Slice day in-process and prints the report.
// Same node code and SQL as the workflows, Postgres via PGlite, mock Twilio, Slack and email. No Docker needed.
// The output is also saved to docs/demo-output.txt.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../src/build/codegen.ts';
import type { KitConfig } from '../src/build/workflows.ts';
import { formatResult } from '../src/sim/format.ts';
import { runScenario } from '../src/sim/runner.ts';
import { createSimDriver } from '../src/sim/simDriver.ts';

const main = async (): Promise<void> => {
  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'config/e2e.json'), 'utf8')) as KitConfig;
  const { driver, close } = await createSimDriver(config);
  try {
    const result = await runScenario(driver);
    const output = formatResult('Missed call recovery kit: demo run (synthetic data)', result);
    console.log(output);
    writeFileSync(resolve(REPO_ROOT, 'docs/demo-output.txt'), output);
    console.log('Saved to docs/demo-output.txt');
    if (result.checks.some((check) => !check.passed)) {
      process.exitCode = 1;
    }
  } finally {
    await close();
  }
};

await main();
