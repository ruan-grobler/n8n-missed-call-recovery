// Code node "Read reply" in workflow 2. Input: the Config item, which carries Twilio's inbound SMS webhook.
import { resolveNow } from '../logic/clock.ts';
import { configFlag, readRecord } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';
import { normalisePhone } from '../logic/phone.ts';
import { classifyReply, previewText } from '../logic/reply.ts';
import type { ReplyIntent } from '../logic/reply.ts';

export interface ReadReplyOut {
  valid: boolean;
  ignore_reason: string | null;
  message_sid: string;
  from_e164: string | null;
  intent: ReplyIntent;
  preview: string;
  now_iso: string;
}

export const readReply = (item: ConfigItem, realNowIso: string): ReadReplyOut => {
  const headers = readRecord(item.headers);
  const body = readRecord(item.body);
  const nowIso = resolveNow(realNowIso, configFlag(item, 'test_clock_enabled'), headers['x-hs-test-clock']);
  const messageSid = String(body.MessageSid ?? body.SmsSid ?? '').trim();
  const phone = normalisePhone(body.From);
  const valid = /^[A-Za-z0-9_-]{1,64}$/.test(messageSid) && phone.ok;
  return {
    valid,
    ignore_reason: valid ? null : 'missing MessageSid or a readable From number',
    message_sid: messageSid,
    from_e164: phone.ok ? phone.e164 : null,
    intent: classifyReply(body.Body, body.OptOutType),
    preview: previewText(body.Body),
    now_iso: nowIso,
  };
};
