// Phone number helpers. South Africa (+27) is the default country.

export type PhoneIssue = 'withheld' | 'invalid';

export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; issue: PhoneIssue };

// Twilio reports a withheld caller ID as "anonymous" or as +266696687 (ANONYMOUS on a keypad).
const WITHHELD_CALLER_IDS: readonly string[] = [
  '',
  'anonymous',
  'restricted',
  'unknown',
  'private',
  'unavailable',
  'blocked',
  '+266696687',
  '266696687',
];

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

// Turns whatever the phone system sends into E.164, for example "+27000000012".
// Handles "082 ...", "27 82 ...", "0027 ...", "+27 (0)82 ..." and "sip:+27...@host".
export const normalisePhone = (raw: unknown, defaultCountryCode = '27'): PhoneResult => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (WITHHELD_CALLER_IDS.includes(text)) {
    return { ok: false, issue: 'withheld' };
  }

  const withoutUri = text.replace(/^(sips?|tel):/, '').replace(/@.*$/, '');
  const withoutTrunkZero = withoutUri.replace(/\(0\)/g, '');
  const hasPlus = withoutTrunkZero.startsWith('+');
  const digits = withoutTrunkZero.replace(/\D/g, '');
  if (digits !== '' && WITHHELD_CALLER_IDS.includes(digits)) {
    return { ok: false, issue: 'withheld' };
  }

  const cc = defaultCountryCode;
  let e164 = '';
  if (hasPlus) {
    e164 = `+${digits}`;
  } else if (/^00[1-9]/.test(digits)) {
    e164 = `+${digits.slice(2)}`;
  } else if (digits.startsWith(cc) && digits.length === cc.length + 9) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('0') && digits.length === 10) {
    e164 = `+${cc}${digits.slice(1)}`;
  }

  // "+27 0xx xxx xxxx" typed with the local trunk zero still in it.
  if (e164.startsWith(`+${cc}0`) && e164.length === cc.length + 11) {
    e164 = `+${cc}${e164.slice(cc.length + 2)}`;
  }

  return E164_PATTERN.test(e164) ? { ok: true, e164 } : { ok: false, issue: 'invalid' };
};

// Allowed prefixes come from Config as a comma separated list, for example "+27".
export const parsePrefixList = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\+\d{1,4}$/.test(part));

export const isAllowedCountry = (e164: string, allowedPrefixes: readonly string[]): boolean =>
  allowedPrefixes.length === 0 || allowedPrefixes.some((prefix) => e164.startsWith(prefix));

// "+27000000012" becomes "+27 00 000 0012" for alerts a manager reads.
export const formatPhoneForPeople = (e164: string): string => {
  const match = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return match ? `+27 ${match[1]} ${match[2]} ${match[3]}` : e164;
};
