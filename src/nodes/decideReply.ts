// Code node "Decide reply" in workflow 2. Input: the row from sql/record-reply.sql, the read reply and Config.
import { configString } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';
import { decideReplyAction } from '../logic/reply.ts';
import type { ReplyAction, ReplyIntent } from '../logic/reply.ts';
import { renderTemplate, trackedLink, twilioMessagesUrl } from '../logic/sms.ts';

export interface DecideReplyOut {
  action: ReplyAction;
  is_new: boolean;
  message_sid: string;
  sms_to: string;
  sms_from: string;
  sms_body: string;
  twilio_messages_url: string;
  now_iso: string;
}

const asIntent = (value: unknown): ReplyIntent => (value === 'opt_out' || value === 'book' ? value : 'other');

// The link goes back with the caller's own tracking token when the kit texted them before,
// so a tap after "YES" still counts against that missed call.
export const decideReply = (
  row: Readonly<Record<string, unknown>>,
  reply: Readonly<Record<string, unknown>>,
  cfg: ConfigItem,
): DecideReplyOut => {
  const action = decideReplyAction({ is_new: row.is_new, opted_out_before: row.opted_out_before }, asIntent(reply.intent));
  const token = typeof row.link_token === 'string' ? row.link_token : '';
  const link = token !== '' ? trackedLink(configString(cfg, 'tracked_link_base'), token) : configString(cfg, 'booking_url');
  const sending = action === 'link_sent';
  return {
    action,
    is_new: row.is_new === true,
    message_sid: String(reply.message_sid),
    sms_to: sending ? String(reply.from_e164) : '',
    sms_from: sending ? configString(cfg, 'twilio_from') : '',
    sms_body: sending ? renderTemplate(configString(cfg, 'rebook_template'), { business: configString(cfg, 'business_name'), link }) : '',
    twilio_messages_url: sending ? twilioMessagesUrl(configString(cfg, 'twilio_api_base'), configString(cfg, 'twilio_account_sid')) : '',
    now_iso: String(reply.now_iso),
  };
};
