// Reads a Twilio voice status callback and decides whether it is a missed call worth texting.
import { isAllowedCountry, normalisePhone } from './phone.ts';
import { parseTwilioTimestamp } from './clock.ts';

export type CallerIssue = 'withheld' | 'invalid' | 'foreign' | null;

export interface ParsedCall {
  isMissed: boolean;
  ignoreReason: string | null;
  callKey: string;
  callSid: string;
  parentCallSid: string | null;
  callStatus: string;
  callerE164: string | null;
  callerIssue: CallerIssue;
  calledAtIso: string;
}

export interface ParseCallOptions {
  missedStatuses: readonly string[];
  allowedPrefixes: readonly string[];
  nowIso: string;
}

const SID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const readSid = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return SID_PATTERN.test(text) ? text : null;
};

export const parseStatusList = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((status) => status.trim().toLowerCase())
    .filter((status) => status !== '');

// Idempotency key: ParentCallSid when present, else CallSid.
// A <Dial> that rings two handsets sends one callback per handset for the same customer call.
// Keying on the parent call means that customer still gets exactly one text.
export const parseStatusCallback = (body: Record<string, unknown>, options: ParseCallOptions): ParsedCall => {
  const callSid = readSid(body.CallSid);
  const parentCallSid = readSid(body.ParentCallSid);
  const callStatus = String(body.CallStatus ?? body.DialCallStatus ?? '').trim().toLowerCase();
  const calledAtIso = parseTwilioTimestamp(body.Timestamp) ?? options.nowIso;

  const base: ParsedCall = {
    isMissed: false,
    ignoreReason: null,
    callKey: parentCallSid ?? callSid ?? '',
    callSid: callSid ?? '',
    parentCallSid,
    callStatus,
    callerE164: null,
    callerIssue: null,
    calledAtIso,
  };

  if (!callSid) {
    return { ...base, ignoreReason: 'no CallSid in the callback' };
  }
  if (!options.missedStatuses.includes(callStatus)) {
    return { ...base, ignoreReason: `status ${callStatus || 'empty'} is not a missed call` };
  }

  const phone = normalisePhone(body.From ?? body.Caller);
  if (!phone.ok) {
    return { ...base, isMissed: true, callerIssue: phone.issue };
  }
  if (!isAllowedCountry(phone.e164, options.allowedPrefixes)) {
    return { ...base, isMissed: true, callerE164: phone.e164, callerIssue: 'foreign' };
  }
  return { ...base, isMissed: true, callerE164: phone.e164 };
};
