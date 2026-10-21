// Starts and stops the docker stack for the e2e run. Secrets are random per run and never written to the repo
// (docker/.e2e is gitignored and deleted on teardown).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../../src/build/codegen.ts';
import { CREDENTIALS } from '../../src/build/n8n.ts';
import { renderWorkflows } from '../build.ts';

export interface StackSecrets {
  dbPassword: string;
  encryptionKey: string;
  webhookUser: string;
  webhookPassword: string;
  twilioAuthToken: string;
}

export interface StackPorts {
  n8n: number;
  mockTwilio: number;
  mockSinks: number;
}

export const SEED_DIR = resolve(REPO_ROOT, 'docker/.e2e');
const PROJECT = 'missed-call-kit-e2e';

export const newSecrets = (): StackSecrets => ({
  dbPassword: randomBytes(18).toString('hex'),
  encryptionKey: randomBytes(24).toString('hex'),
  webhookUser: 'twilio',
  webhookPassword: randomBytes(18).toString('hex'),
  twilioAuthToken: randomBytes(16).toString('hex'),
});

export const writeSeed = (secrets: StackSecrets): void => {
  rmSync(SEED_DIR, { recursive: true, force: true });
  mkdirSync(resolve(SEED_DIR, 'workflows'), { recursive: true });
  for (const [file, json] of Object.entries(renderWorkflows(resolve(REPO_ROOT, 'config/e2e.json')))) {
    writeFileSync(resolve(SEED_DIR, 'workflows', file), json);
  }
  const credentials = [
    {
      ...CREDENTIALS.postgres.ref,
      type: CREDENTIALS.postgres.type,
      data: { host: 'postgres', port: 5432, database: 'missed_calls', user: 'kit', password: secrets.dbPassword, ssl: 'disable', maxConnections: 10, allowUnauthorizedCerts: false, sshTunnel: false },
    },
    {
      ...CREDENTIALS.twilioApi.ref,
      type: CREDENTIALS.twilioApi.type,
      data: { user: 'AC00000000000000000000000000000000', password: secrets.twilioAuthToken },
    },
    {
      ...CREDENTIALS.webhookAuth.ref,
      type: CREDENTIALS.webhookAuth.type,
      data: { user: secrets.webhookUser, password: secrets.webhookPassword },
    },
    {
      ...CREDENTIALS.slack.ref,
      type: CREDENTIALS.slack.type,
      data: { name: 'Authorization', value: 'Bearer mock-slack-token' },
    },
    {
      ...CREDENTIALS.smtp.ref,
      type: CREDENTIALS.smtp.type,
      data: { host: 'mock-sinks', port: 2525, user: 'mock', password: 'mock', secure: false, disableStartTls: true },
    },
  ];
  writeFileSync(resolve(SEED_DIR, 'credentials.json'), `${JSON.stringify(credentials, null, 2)}\n`);
};

const composeEnv = (secrets: StackSecrets, ports: StackPorts): NodeJS.ProcessEnv => ({
  ...process.env,
  KIT_DB_PASSWORD: secrets.dbPassword,
  KIT_N8N_ENCRYPTION_KEY: secrets.encryptionKey,
  KIT_N8N_PORT: String(ports.n8n),
  KIT_MOCK_TWILIO_PORT: String(ports.mockTwilio),
  KIT_MOCK_SINKS_PORT: String(ports.mockSinks),
});

export const compose = (secrets: StackSecrets, ports: StackPorts, args: readonly string[], quiet = false): string =>
  execFileSync('docker', ['compose', '-p', PROJECT, '-f', resolve(REPO_ROOT, 'docker-compose.yml'), ...args], {
    cwd: REPO_ROOT,
    env: composeEnv(secrets, ports),
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  });

export const dockerAvailable = (): boolean => {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

export const stackUp = (secrets: StackSecrets, ports: StackPorts): void => {
  writeSeed(secrets);
  compose(secrets, ports, ['up', '-d', '--wait', '--wait-timeout', '240']);
};

export const stackDown = (secrets: StackSecrets, ports: StackPorts): void => {
  try {
    compose(secrets, ports, ['down', '-v', '--remove-orphans'], true);
  } finally {
    rmSync(SEED_DIR, { recursive: true, force: true });
  }
};

// Runs SQL inside the Postgres container, for seeding prior days and for reading results.
export const psql = (secrets: StackSecrets, ports: StackPorts, sql: string): string =>
  compose(secrets, ports, ['exec', '-T', 'postgres', 'psql', '-U', 'kit', '-d', 'missed_calls', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], true);
