// SMS text helpers. One GSM-7 segment is 160 characters, so the default copy is kept under that.

// Fills {business} and {link} style placeholders. Unknown placeholders are left as they are.
export const renderTemplate = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole: string, key: string) => values[key] ?? whole);

// The tracked link counts the tap, then redirects to the real booking page.
export const trackedLink = (linkBase: string, token: string): string =>
  `${linkBase}${linkBase.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

export interface SegmentInfo {
  encoding: 'GSM-7' | 'UCS-2';
  units: number;
  segments: number;
}

export const smsSegments = (text: string): SegmentInfo => {
  const chars = Array.from(text);
  const gsm = chars.every((char) => GSM7_BASIC.includes(char) || GSM7_EXTENDED.includes(char));
  if (gsm) {
    const units = chars.reduce((sum, char) => sum + (GSM7_EXTENDED.includes(char) ? 2 : 1), 0);
    return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = chars.reduce((sum, char) => sum + (char.length > 1 ? 2 : 1), 0);
  return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
};

// Twilio's Messages API lives under the account. The base URL is configurable for regions and for mocks.
export const twilioMessagesUrl = (apiBase: string, accountSid: string): string =>
  `${apiBase.replace(/\/+$/, '')}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
