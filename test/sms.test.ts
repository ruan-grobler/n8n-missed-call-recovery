import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderTemplate, smsSegments, trackedLink, twilioMessagesUrl } from '../src/logic/sms.ts';

const defaults = JSON.parse(readFileSync(new URL('../config/default.json', import.meta.url), 'utf8')) as Record<string, string>;

describe('renderTemplate', () => {
  it('fills known placeholders and leaves unknown ones', () => {
    expect(renderTemplate('{business}: {link} {other}', { business: 'Harbour Slice', link: 'https://x.example.com' }))
      .toBe('Harbour Slice: https://x.example.com {other}');
  });
});

describe('trackedLink', () => {
  it('adds the token as a query parameter', () => {
    expect(trackedLink('https://n8n.example.com/webhook/hs/book', 'abc123def456')).toBe('https://n8n.example.com/webhook/hs/book?t=abc123def456');
    expect(trackedLink('https://n8n.example.com/webhook/hs/book?src=sms', 'abc123def456')).toBe('https://n8n.example.com/webhook/hs/book?src=sms&t=abc123def456');
  });
});

describe('smsSegments', () => {
  it('counts plain GSM text as one segment up to 160 characters', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM-7', units: 160, segments: 1 });
    expect(smsSegments('a'.repeat(161))).toEqual({ encoding: 'GSM-7', units: 161, segments: 2 });
  });

  it('counts extended characters as two units', () => {
    expect(smsSegments('€[]')).toEqual({ encoding: 'GSM-7', units: 6, segments: 1 });
  });

  it('falls back to UCS-2 for emoji and other characters', () => {
    expect(smsSegments('Pizza 🍕')).toEqual({ encoding: 'UCS-2', units: 8, segments: 1 });
    expect(smsSegments('ş'.repeat(71)).segments).toBe(2);
  });

  it('keeps the shipped texts to one segment even with a long n8n Cloud URL', () => {
    const link = trackedLink('https://yourcompanyname.app.n8n.cloud/webhook/hs/book', 'abc123def456');
    for (const template of [defaults.sms_template, defaults.rebook_template]) {
      const text = renderTemplate(String(template), { business: 'Harbour Slice', link });
      expect(smsSegments(text)).toMatchObject({ encoding: 'GSM-7', segments: 1 });
    }
  });
});

describe('twilioMessagesUrl', () => {
  it('builds the Messages endpoint and tolerates a trailing slash', () => {
    expect(twilioMessagesUrl('https://api.twilio.com/', 'AC123')).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
  });
});
