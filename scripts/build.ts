// npm run build                 writes workflows/*.json from TypeScript, SQL and config/default.json
// npm run build -- --check      fails if workflows/*.json is out of date (CI runs this)
// npm run build -- --config my.json --out dist/mine   builds a copy with your own values
// npm run build -- --env --out dist/live              same, with KIT_* environment variables on top (live mode)
// Secrets never go through here: the Twilio token, Slack token and database password live in n8n credentials.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../src/build/codegen.ts';
import { findDrift } from '../src/build/drift.ts';
import type { N8nWorkflow } from '../src/build/n8n.ts';
import { buildAllWorkflows } from '../src/build/workflows.ts';
import type { KitConfig } from '../src/build/workflows.ts';

const argValue = (flag: string, fallback: string): string => {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
};

// KIT_BUSINESS_NAME overrides business_name, KIT_QUIET_START overrides quiet_start, and so on.
// Values keep the type of the default: numbers stay numbers, true and false stay booleans.
export const envOverrides = (config: KitConfig, env: NodeJS.ProcessEnv): KitConfig => {
  const merged: Record<string, string | number | boolean> = { ...config };
  for (const [key, fallback] of Object.entries(config)) {
    const raw = env[`KIT_${key.toUpperCase()}`];
    if (raw === undefined || raw === '') {
      continue;
    }
    if (typeof fallback === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`KIT_${key.toUpperCase()} must be a number`);
      }
      merged[key] = value;
    } else if (typeof fallback === 'boolean') {
      if (raw !== 'true' && raw !== 'false') {
        throw new Error(`KIT_${key.toUpperCase()} must be true or false`);
      }
      merged[key] = raw === 'true';
    } else {
      merged[key] = raw;
    }
  }
  return merged;
};

export const renderWorkflows = (configPath: string, env?: NodeJS.ProcessEnv): Record<string, string> => {
  const base = JSON.parse(readFileSync(configPath, 'utf8')) as KitConfig;
  const config = env ? envOverrides(base, env) : base;
  const rendered: Record<string, string> = {};
  for (const [file, workflow] of Object.entries(buildAllWorkflows(config))) {
    rendered[file] = `${JSON.stringify(workflow, null, 2)}\n`;
  }
  return rendered;
};

const main = (): void => {
  const configPath = resolve(REPO_ROOT, argValue('--config', 'config/default.json'));
  const outDir = resolve(REPO_ROOT, argValue('--out', 'workflows'));
  const check = process.argv.includes('--check');
  const useEnv = process.argv.includes('--env');
  if (useEnv && outDir === resolve(REPO_ROOT, 'workflows')) {
    console.error('--env needs --out, for example --out dist/live. Real values must never be written into workflows/.');
    process.exit(1);
  }
  const rendered = renderWorkflows(configPath, useEnv ? process.env : undefined);
  const stale: string[] = [];
  mkdirSync(outDir, { recursive: true });
  for (const [file, json] of Object.entries(rendered)) {
    const target = resolve(outDir, file);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current === json) {
      continue;
    }
    if (check) {
      const problems = current === ''
        ? ['file is missing']
        : findDrift(JSON.parse(current) as N8nWorkflow, JSON.parse(json) as N8nWorkflow);
      stale.push(`${file}: ${problems.length > 0 ? problems.join('; ') : 'formatting differs'}`);
    } else {
      writeFileSync(target, json);
      console.log(`wrote ${target}`);
    }
  }
  if (check && stale.length > 0) {
    console.error(`Out of date:\n  ${stale.join('\n  ')}\nRun "npm run build" and commit the result.`);
    process.exit(1);
  }
  if (check) {
    console.log(`workflows are in sync (${Object.keys(rendered).length} files)`);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(REPO_ROOT, 'scripts/build.ts')) {
  main();
}
