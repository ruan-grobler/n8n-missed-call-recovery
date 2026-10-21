// Classifies an inbound SMS reply and decides what the kit does with it.

export type ReplyIntent = 'opt_out' | 'book' | 'other';

// Opt out wins over everything else. STOP, UNSUBSCRIBE and OPT OUT count anywhere in the message.
// CANCEL, END, QUIT and friends only count as the whole message, so "cancel my order" or
// "remove olives" reaches the manager instead of silently opting someone out.
const OPT_OUT_ANYWHERE: readonly string[] = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'OPTOUT'];
const OPT_OUT_PHRASES: readonly string[] = ['OPT OUT', 'STOP ALL'];
const OPT_OUT_WHOLE_MESSAGE: readonly string[] = ['CANCEL', 'END', 'QUIT', 'REVOKE', 'REMOVE ME'];
const BOOK_FIRST_WORDS: readonly string[] = ['YES', 'Y', 'YEP', 'YEAH', 'JA'];
const BOOK_ANYWHERE: readonly string[] = ['BOOK', 'BOOKING'];

const normaliseText = (body: unknown): string =>
  String(body ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Twilio adds OptOutType=STOP when its own opt out handling caught the message. Trust it too.
export const classifyReply = (body: unknown, twilioOptOutType?: unknown): ReplyIntent => {
  if (String(twilioOptOutType ?? '').toUpperCase() === 'STOP') {
    return 'opt_out';
  }
  const text = normaliseText(body);
  if (text === '') {
    return 'other';
  }
  const words = text.split(' ');
  const padded = ` ${text} `;
  const optOut = words.some((word) => OPT_OUT_ANYWHERE.includes(word))
    || OPT_OUT_PHRASES.some((phrase) => padded.includes(` ${phrase} `))
    || OPT_OUT_WHOLE_MESSAGE.includes(text);
  if (optOut) {
    return 'opt_out';
  }
  if (BOOK_FIRST_WORDS.includes(words[0] ?? '') || words.some((word) => BOOK_ANYWHERE.includes(word))) {
    return 'book';
  }
  return 'other';
};

// These are also the values stored in hs_sms_replies.action (plus 'pending' and 'link_failed').
export type ReplyAction =
  | 'duplicate'
  | 'opted_out'
  | 'link_sent'
  | 'blocked_opted_out'
  | 'manager_alerted';

// One row back from sql/record-reply.sql.
export interface RecordReplyRow {
  is_new: unknown;
  opted_out_before: unknown;
}

// A number that opted out never gets another SMS, even if it later asks for the link.
// The manager hears about it instead and can decide to phone them.
export const decideReplyAction = (row: RecordReplyRow, intent: ReplyIntent): ReplyAction => {
  if (row.is_new !== true) {
    return 'duplicate';
  }
  if (intent === 'opt_out') {
    return 'opted_out';
  }
  if (intent === 'book') {
    return row.opted_out_before === true ? 'blocked_opted_out' : 'link_sent';
  }
  return 'manager_alerted';
};

// Alerts carry at most this much of the customer's message.
export const previewText = (body: unknown, maxLength = 300): string => {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
};
