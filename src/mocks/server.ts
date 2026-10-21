// HTTP front for the mocks. Run as: node src/mocks/server.ts twilio   or   node src/mocks/server.ts sinks
// Docker compose starts one container for each. Only Node built-ins are used, so no npm install is needed.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createSinksCore } from './sinksCore.ts';
import type { SinksCore } from './sinksCore.ts';
import { startSmtpSink } from './smtpSink.ts';
import { createTwilioCore } from './twilioCore.ts';
import type { TwilioCore } from './twilioCore.ts';

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const hasBasicAuth = (req: IncomingMessage): boolean => /^Basic\s+\S+/.test(req.headers.authorization ?? '');
const hasBearer = (req: IncomingMessage): boolean => /^Bearer\s+\S+/.test(req.headers.authorization ?? '');

export const createTwilioServer = (core: TwilioCore): Server =>
  createServer((req, res) => {
    void (async (): Promise<void> => {
      const url = new URL(req.url ?? '/', 'http://mock');
      const send = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(url.pathname);
      if (req.method === 'POST' && send) {
        const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
        const result = core.sendMessage(decodeURIComponent(send[1] ?? ''), form, hasBasicAuth(req));
        sendJson(res, result.status, result.body);
      } else if (req.method === 'GET' && url.pathname === '/_mock/messages') {
        sendJson(res, 200, { messages: core.messages() });
      } else if (req.method === 'POST' && url.pathname === '/_mock/clock') {
        const body = JSON.parse((await readBody(req)) || '{}') as { at?: string | null };
        core.setClock(body.at ?? null);
        sendJson(res, 200, { ok: true });
      } else if (req.method === 'POST' && url.pathname === '/_mock/reset') {
        core.reset();
        sendJson(res, 200, { ok: true });
      } else if (url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 404, { code: 20404, message: 'The requested resource was not found' });
      }
    })().catch((error: unknown) => sendJson(res, 500, { message: String(error) }));
  });

export const createSinksServer = (core: SinksCore): Server =>
  createServer((req, res) => {
    void (async (): Promise<void> => {
      const url = new URL(req.url ?? '/', 'http://mock');
      if (req.method === 'POST' && url.pathname === '/api/chat.postMessage') {
        const raw = await readBody(req);
        const result = core.postSlack(hasBearer(req), raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
        sendJson(res, result.status, result.body);
      } else if (req.method === 'GET' && url.pathname === '/_mock/slack') {
        sendJson(res, 200, { messages: core.slack() });
      } else if (req.method === 'GET' && url.pathname === '/_mock/emails') {
        sendJson(res, 200, { emails: core.emails() });
      } else if (req.method === 'POST' && url.pathname === '/_mock/reset') {
        core.reset();
        sendJson(res, 200, { ok: true });
      } else if (url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 404, { ok: false, error: 'unknown_method' });
      }
    })().catch((error: unknown) => sendJson(res, 500, { ok: false, error: String(error) }));
  });

const main = async (): Promise<void> => {
  const role = process.argv[2];
  if (role === 'twilio') {
    const failTo = (process.env.MOCK_TWILIO_FAIL_TO ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    createTwilioServer(createTwilioCore(failTo)).listen(4010, '0.0.0.0', () => console.log('mock Twilio on :4010'));
  } else if (role === 'sinks') {
    const core = createSinksCore();
    createSinksServer(core).listen(4020, '0.0.0.0', () => console.log('mock Slack on :4020'));
    await startSmtpSink(2525, core.addEmail);
    console.log('mock SMTP on :2525');
  } else {
    console.error('usage: node src/mocks/server.ts twilio|sinks');
    process.exit(2);
  }
};

if (process.argv[1]?.endsWith('server.ts')) {
  void main();
}
