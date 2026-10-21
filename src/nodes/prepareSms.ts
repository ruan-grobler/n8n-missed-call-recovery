// Code node "Prepare SMS" in workflow 1. Takes "send" decisions or released queue rows and builds the Twilio request.
import { configString } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';
import { renderTemplate, smsSegments, trackedLink, twilioMessagesUrl } from '../logic/sms.ts';

export interface PreparedSms {
  call_key: string;
  sms_to: string;
  sms_from: string;
  sms_body: string;
  segments: number;
  twilio_messages_url: string;
  now_iso: string;
}

// Live decisions carry action "send". Released queue rows carry outcome "sending".
// Anything else (opted out at release time, expired, the Postgres "success" placeholder) is skipped.
export const prepareSms = (inputs: readonly Readonly<Record<string, unknown>>[], cfg: ConfigItem): PreparedSms[] =>
  inputs
    .filter((input) => (input.action === 'send' || input.outcome === 'sending')
      && typeof input.caller_e164 === 'string' && input.caller_e164 !== ''
      && typeof input.link_token === 'string' && input.link_token !== '')
    .map((input) => {
      const body = renderTemplate(configString(cfg, 'sms_template'), {
        business: configString(cfg, 'business_name'),
        link: trackedLink(configString(cfg, 'tracked_link_base'), String(input.link_token)),
      });
      return {
        call_key: String(input.call_key),
        sms_to: String(input.caller_e164),
        sms_from: configString(cfg, 'twilio_from'),
        sms_body: body,
        segments: smsSegments(body).segments,
        twilio_messages_url: twilioMessagesUrl(configString(cfg, 'twilio_api_base'), configString(cfg, 'twilio_account_sid')),
        now_iso: String(input.now_iso),
      };
    });
