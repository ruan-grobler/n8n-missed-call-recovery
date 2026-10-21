// A tiny SMTP server that accepts any login and keeps every message in memory.
// It speaks just enough SMTP for nodemailer, which n8n's Send Email node uses. No TLS, local use only.
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type { CapturedEmail } from './sinksCore.ts';

const decodeQuotedPrintable = (text: string): string => {
  const bytes: number[] = [];
  const joined = text.replace(/=\r?\n/g, '');
  for (let i = 0; i < joined.length; i += 1) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i] ?? '', 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
};

// Subjects may arrive as RFC 2047 encoded words, for example =?UTF-8?Q?...?=
const decodeHeader = (value: string): string =>
  value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_whole: string, _charset: string, kind: string, data: string) =>
    kind.toUpperCase() === 'B'
      ? Buffer.from(data, 'base64').toString('utf8')
      : decodeQuotedPrintable(data.replace(/_/g, ' ')));

export const parseEmail = (raw: string, envelopeFrom: string, envelopeTo: readonly string[]): CapturedEmail => {
  const split = raw.search(/\r?\n\r?\n/);
  const head = split >= 0 ? raw.slice(0, split) : raw;
  const body = split >= 0 ? raw.slice(split).replace(/^\r?\n\r?\n/, '') : '';
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
  const text = encoding === 'quoted-printable'
    ? decodeQuotedPrintable(body)
    : encoding === 'base64'
      ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
      : body;
  return {
    from: decodeHeader(headers.get('from') ?? envelopeFrom),
    to: [...envelopeTo],
    subject: decodeHeader(headers.get('subject') ?? ''),
    text: text.replace(/\r\n/g, '\n').trimEnd(),
  };
};

const handleSession = (socket: Socket, onEmail: (email: CapturedEmail) => void): void => {
  let buffer = '';
  let mode: 'command' | 'data' | 'login-user' | 'login-pass' = 'command';
  let from = '';
  let to: string[] = [];
  let dataLines: string[] = [];
  const reply = (line: string): void => {
    socket.write(`${line}\r\n`);
  };
  const onLine = (line: string): void => {
    if (mode === 'data') {
      if (line === '.') {
        onEmail(parseEmail(dataLines.join('\r\n'), from, to));
        dataLines = [];
        mode = 'command';
        reply('250 2.0.0 OK queued');
      } else {
        dataLines.push(line.startsWith('..') ? line.slice(1) : line);
      }
      return;
    }
    if (mode === 'login-user') {
      mode = 'login-pass';
      reply('334 UGFzc3dvcmQ6');
      return;
    }
    if (mode === 'login-pass') {
      mode = 'command';
      reply('235 2.7.0 Authentication successful');
      return;
    }
    const verb = line.split(' ')[0]?.toUpperCase() ?? '';
    if (verb === 'EHLO') {
      reply('250-mock-smtp');
      reply('250-AUTH PLAIN LOGIN');
      reply('250 8BITMIME');
    } else if (verb === 'HELO') {
      reply('250 mock-smtp');
    } else if (verb === 'AUTH') {
      if (/^AUTH LOGIN/i.test(line)) {
        mode = 'login-user';
        reply('334 VXNlcm5hbWU6');
      } else {
        reply('235 2.7.0 Authentication successful');
      }
    } else if (verb === 'MAIL') {
      from = (/<([^>]*)>/.exec(line)?.[1]) ?? '';
      to = [];
      reply('250 2.1.0 OK');
    } else if (verb === 'RCPT') {
      to.push((/<([^>]*)>/.exec(line)?.[1]) ?? '');
      reply('250 2.1.5 OK');
    } else if (verb === 'DATA') {
      mode = 'data';
      reply('354 End data with <CR><LF>.<CR><LF>');
    } else if (verb === 'RSET') {
      from = '';
      to = [];
      reply('250 2.0.0 OK');
    } else if (verb === 'NOOP') {
      reply('250 2.0.0 OK');
    } else if (verb === 'QUIT') {
      reply('221 2.0.0 Bye');
      socket.end();
    } else {
      reply('502 5.5.2 Command not implemented');
    }
  };
  reply('220 mock-smtp ESMTP ready');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end = buffer.indexOf('\r\n');
    while (end >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      onLine(line);
      end = buffer.indexOf('\r\n');
    }
  });
  socket.on('error', () => socket.destroy());
};

export const startSmtpSink = (port: number, onEmail: (email: CapturedEmail) => void, host = '0.0.0.0'): Promise<Server> =>
  new Promise((resolvePromise) => {
    const server = createServer((socket) => handleSession(socket, onEmail));
    server.listen(port, host, () => resolvePromise(server));
  });
