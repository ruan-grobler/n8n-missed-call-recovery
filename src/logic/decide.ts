// What to do with a missed call once the database has claimed it.
import { isQuietHours, minutesBetween, nextQuietEnd, toIso } from './clock.ts';
import type { CallerIssue } from './callStatus.ts';

export type SkipOutcome = 'opted_out' | 'repeat_caller' | 'no_caller_id' | 'foreign_number';

export type CallDecision =
  | { action: 'duplicate'; reason: string }
  | { action: 'skip'; outcome: SkipOutcome; reason: string }
  | { action: 'queue'; sendAfterIso: string; reason: string }
  | { action: 'send'; reason: string };

// One row back from sql/claim-missed-call.sql.
export interface ClaimRow {
  callback_count: unknown;
  opted_out: unknown;
  last_sent_at: unknown;
  has_queued: unknown;
}

export interface DecideOptions {
  nowIso: string;
  timezone: string;
  quietStart: string;
  quietEnd: string;
  repeatCooldownMinutes: number;
}

export const decideMissedCall = (claim: ClaimRow, callerIssue: CallerIssue, options: DecideOptions): CallDecision => {
  if (Number(claim.callback_count) !== 1) {
    return { action: 'duplicate', reason: `callback number ${String(claim.callback_count)} for this call, already handled` };
  }
  if (callerIssue === 'withheld' || callerIssue === 'invalid') {
    return { action: 'skip', outcome: 'no_caller_id', reason: `caller ID ${callerIssue}` };
  }
  if (callerIssue === 'foreign') {
    return { action: 'skip', outcome: 'foreign_number', reason: 'number outside the allowed countries' };
  }
  if (claim.opted_out === true) {
    return { action: 'skip', outcome: 'opted_out', reason: 'this number opted out' };
  }
  if (claim.has_queued === true) {
    return { action: 'skip', outcome: 'repeat_caller', reason: 'a text to this number is already waiting for quiet hours to end' };
  }
  const lastSentIso = toIso(claim.last_sent_at);
  if (lastSentIso && options.repeatCooldownMinutes > 0
    && minutesBetween(lastSentIso, options.nowIso) < options.repeatCooldownMinutes) {
    return { action: 'skip', outcome: 'repeat_caller', reason: `already texted within ${options.repeatCooldownMinutes} minutes` };
  }
  if (isQuietHours(options.nowIso, options.timezone, options.quietStart, options.quietEnd)) {
    return {
      action: 'queue',
      sendAfterIso: nextQuietEnd(options.nowIso, options.timezone, options.quietEnd),
      reason: `quiet hours ${options.quietStart} to ${options.quietEnd}`,
    };
  }
  return { action: 'send', reason: 'missed call, outside quiet hours' };
};
