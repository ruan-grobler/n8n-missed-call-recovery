// Messages for the manager. These do contain the caller's number, because the manager needs to act on them.
import { formatPhoneForPeople } from './phone.ts';
import { localTimeLabel } from './clock.ts';

export interface Alert {
  alert_subject: string;
  alert_text: string;
}

// Pulls the useful part out of whatever n8n stored for a failed Twilio request.
// Twilio errors look like {"code":21614,"message":"'To' number is not a valid mobile number",...}.
// n8n may nest that body inside its own error object, sometimes as an escaped string.
export const describeTwilioError = (raw: unknown): string => {
  const text = (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).replace(/\\+"/g, '"');
  const code = /"code"\s*:\s*"?(\d{5})\b/.exec(text);
  const messagePattern = /"message"\s*:\s*"([^"]{1,300})"/;
  if (code) {
    const after = messagePattern.exec(text.slice(code.index, code.index + 400));
    const before = messagePattern.exec(text.slice(Math.max(0, code.index - 400), code.index));
    const message = after?.[1] ?? before?.[1];
    return message ? `${message} (Twilio error ${code[1]})` : `Twilio error ${code[1]}`;
  }
  const message = messagePattern.exec(text);
  return message?.[1] ?? (text.slice(0, 200) || 'unknown error');
};

export const failedSmsAlert = (
  business: string,
  callerE164: string,
  calledAtIso: string,
  timezone: string,
  error: string,
): Alert => ({
  alert_subject: `${business}: a missed caller could not be texted`,
  alert_text: `${business}: we could not text a missed caller (${formatPhoneForPeople(callerE164)}, called at `
    + `${localTimeLabel(calledAtIso, timezone)}). ${error}. Please call them back.`,
});

export const replyAlert = (
  business: string,
  fromE164: string,
  receivedAtIso: string,
  timezone: string,
  preview: string,
  blockedOptOut: boolean,
): Alert => {
  const who = formatPhoneForPeople(fromE164);
  const at = localTimeLabel(receivedAtIso, timezone);
  if (blockedOptOut) {
    return {
      alert_subject: `${business}: opted out customer asked for the booking link`,
      alert_text: `${business}: ${who} asked for the booking link at ${at} ("${preview}"), but this number opted out `
        + 'earlier, so the kit did not text them. Phone them if you want to help.',
    };
  }
  return {
    alert_subject: `${business}: new SMS reply from a missed caller`,
    alert_text: `${business}: ${who} replied at ${at}: "${preview}". Reply to them from the shop phone.`,
  };
};

export const linkFailedAlert = (business: string, fromE164: string, error: string): Alert => ({
  alert_subject: `${business}: booking link could not be sent`,
  alert_text: `${business}: ${formatPhoneForPeople(fromE164)} asked for the booking link, but the SMS failed. `
    + `${error}. Please send it by hand.`,
});
