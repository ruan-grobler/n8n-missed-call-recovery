// The mocks are test infrastructure, so they get tests too: over real HTTP and a real SMTP socket.
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSinksServer, createTwilioServer } from '../src/mocks/server.ts';
import { createSinksCore } from '../src/mocks/sinksCore.ts';
import { parseEmail, startSmtpSink } from '../src/mocks/smtpSink.ts';
import { createTwilioCore } from '../src/mocks/twilioCore.ts';

const listen = (server: Server): Promise<string> =>
  new Promise((done) => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

describe('mock Twilio over HTTP', () => {
  const core = createTwilioCore(['+27000000035']);
  const server = createTwilioServer(core);
  let base = '';
  const send = (form: Record<string, string>, auth = true): Promise<Response> =>
    fetch(`${base}/2010-04-01/Accounts/AC1/Messages.json`, {
      method: 'POST',
      headers: auth ? { authorization: `Basic ${Buffer.from('AC1:token').toString('base64')}` } : {},
      body: new URLSearchParams(form),
    });

  beforeAll(async () => {
    base = await listen(server);
  });
  afterAll(() => {
    server.close();
  });

  it('accepts a valid message and records the simulated time', async () => {
    await fetch(`${base}/_mock/clock`, { method: 'POST', body: JSON.stringify({ at: '2026-10-16T12:00:00+02:00' }) });
    const response = await send({ To: '+27000000001', From: '+27000000000', Body: 'hi' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ sid: 'SM00000000000000000000000000000001', status: 'queued', to: '+27000000001' });
    const listed = (await (await fetch(`${base}/_mock/messages`)).json()) as { messages: { simulatedAt: string }[] };
    expect(listed.messages[0]?.simulatedAt).toBe('2026-10-16T12:00:00+02:00');
  });

  it('answers like Twilio when something is wrong', async () => {
    expect((await send({ To: '+27000000001', From: '+27000000000', Body: 'hi' }, false)).status).toBe(401);
    expect(await (await send({ To: '0821', From: '+27000000000', Body: 'hi' })).json()).toMatchObject({ code: 21211 });
    expect(await (await send({ To: '+27000000001', From: '', Body: '' })).json()).toMatchObject({ code: 21602 });
    const landline = await send({ To: '+27000000035', From: '+27000000000', Body: 'hi' });
    expect(landline.status).toBe(400);
    expect(await landline.json()).toEqual({ code: 21614, message: "'To' number is not a valid mobile number", more_info: 'https://www.twilio.com/docs/errors/21614', status: 400 });
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('resets', async () => {
    await fetch(`${base}/_mock/reset`, { method: 'POST' });
    expect(core.messages()).toHaveLength(0);
  });
});

describe('mock Slack over HTTP', () => {
  const core = createSinksCore();
  const server = createSinksServer(core);
  let base = '';
  const post = (body: unknown, auth = true): Promise<Response> =>
    fetch(`${base}/api/chat.postMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer test' } : {}) },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    base = await listen(server);
  });
  afterAll(() => {
    server.close();
  });

  it('records posts and answers ok false like Slack does', async () => {
    expect(await (await post({ channel: '#a', text: 'hello' })).json()).toMatchObject({ ok: true, channel: '#a' });
    expect(await (await post({ channel: '#a', text: 'hello' }, false)).json()).toEqual({ ok: false, error: 'not_authed' });
    expect(await (await post({ text: 'hello' })).json()).toEqual({ ok: false, error: 'channel_not_found' });
    expect(await (await post({ channel: '#a' })).json()).toEqual({ ok: false, error: 'no_text' });
    expect(((await (await fetch(`${base}/_mock/slack`)).json()) as { messages: unknown[] }).messages).toHaveLength(1);
    expect(((await (await fetch(`${base}/_mock/emails`)).json()) as { emails: unknown[] }).emails).toHaveLength(0);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    await fetch(`${base}/_mock/reset`, { method: 'POST' });
    expect(core.slack()).toHaveLength(0);
  });
});

describe('SMTP sink', () => {
  // Plays the client side of an SMTP session, one command per server reply.
  const session = async (port: number, commands: readonly string[]): Promise<string[]> => {
    const socket = connect(port, '127.0.0.1');
    const replies: string[] = [];
    let buffer = '';
    let resolveReply: (() => void) | null = null;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (/\r\n$/.test(buffer) && !/^\d{3}-/m.test(buffer.split('\r\n').at(-2) ?? '')) {
        replies.push(buffer.trim());
        buffer = '';
        resolveReply?.();
      }
    });
    const nextReply = (): Promise<void> => new Promise((done) => {
      resolveReply = done;
    });
    await nextReply();
    for (const command of commands) {
      const waiting = nextReply();
      socket.write(`${command}\r\n`);
      await waiting;
    }
    socket.end();
    return replies;
  };

  it('accepts a message from a nodemailer style client and decodes it', async () => {
    const inbox: ReturnType<typeof parseEmail>[] = [];
    const server = await startSmtpSink(0, (email) => inbox.push(email), '127.0.0.1');
    const port = (server.address() as AddressInfo).port;
    const replies = await session(port, [
      'EHLO client',
      `AUTH PLAIN ${Buffer.from('\0user\0pass').toString('base64')}`,
      'MAIL FROM:<alerts@harbourslice.example.com>',
      'RCPT TO:<manager@harbourslice.example.com>',
      'DATA',
      'From: alerts@harbourslice.example.com\r\nSubject: =?UTF-8?Q?Report_=E2=9C=93?=\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nMissed calls: 40=\r\n done\r\n..dot line\r\n.',
      'NOOP',
      'RSET',
      'HELO client',
      'AUTH LOGIN',
      Buffer.from('user').toString('base64'),
      Buffer.from('pass').toString('base64'),
      'STARTTLS',
      'QUIT',
    ]);
    server.close();
    expect(replies[0]).toMatch(/^220 /);
    expect(replies[1]).toContain('250-AUTH PLAIN LOGIN');
    expect(replies.at(-2)).toMatch(/^502 /);
    expect(replies.at(-1)).toMatch(/^221 /);
    expect(inbox).toEqual([{
      from: 'alerts@harbourslice.example.com',
      to: ['manager@harbourslice.example.com'],
      subject: 'Report ✓',
      text: 'Missed calls: 40 done\n.dot line',
    }]);
  });

  it('decodes base64 bodies and falls back to the envelope sender', () => {
    const email = parseEmail(`Subject: hi\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('hello there').toString('base64')}`, 'env@example.com', ['to@example.com']);
    expect(email).toEqual({ from: 'env@example.com', to: ['to@example.com'], subject: 'hi', text: 'hello there' });
    expect(parseEmail('no body at all', 'env@example.com', []).text).toBe('');
  });
});
