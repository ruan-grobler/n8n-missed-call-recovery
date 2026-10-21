// Daily report. Counts only, no names or numbers, so it is safe to post in Slack or email (POPIA minimality).
import { isWithin, toIso } from './clock.ts';
import type { ReportWindow } from './clock.ts';

// The row shapes come from sql/daily-report.sql. Timestamps arrive as ISO strings or Dates.
export interface ReportCallRow {
  outcome: string;
  called_at: unknown;
  sent_at: unknown;
  send_after: unknown;
  clicked_at: unknown;
  callback_count: unknown;
}

export interface ReportReplyRow {
  intent: string;
  action: string;
  received_at: unknown;
}

export interface ReportData {
  calls: readonly ReportCallRow[];
  replies: readonly ReportReplyRow[];
  opt_outs: unknown;
}

export interface ReportCounts {
  missedCalls: number;
  textsSent: number;
  missedCallTexts: number;
  bookingLinksResent: number;
  replies: number;
  repliesBook: number;
  repliesOptOut: number;
  repliesOther: number;
  bookingsClicked: number;
  optOuts: number;
  heldForMorning: number;
  notTexted: number;
  repeatCallers: number;
  optedOutCallers: number;
  noCallerId: number;
  foreignNumbers: number;
  expired: number;
  failedSends: number;
  stuckSends: number;
  duplicateCallbacks: number;
  managerAlerts: number;
}

export interface DailyReport {
  date: string;
  subject: string;
  text: string;
  counts: ReportCounts;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const countReport = (data: ReportData, window: ReportWindow): ReportCounts => {
  const inWindow = (value: unknown): boolean => isWithin(toIso(value), window.startIso, window.endIso);
  const calls = data.calls.filter((call) => inWindow(call.called_at));
  const byOutcome = (outcome: string): number => calls.filter((call) => call.outcome === outcome).length;
  const replies = data.replies.filter((reply) => inWindow(reply.received_at));
  const missedCallTexts = data.calls.filter((call) => inWindow(call.sent_at)).length;
  const bookingLinksResent = replies.filter((reply) => reply.action === 'link_sent').length;
  const heldForMorning = calls.filter((call) => {
    const sendAfter = toIso(call.send_after);
    return sendAfter !== null && sendAfter >= window.endIso;
  }).length;

  const repeatCallers = byOutcome('repeat_caller');
  const optedOutCallers = byOutcome('opted_out');
  const noCallerId = byOutcome('no_caller_id');
  const foreignNumbers = byOutcome('foreign_number');
  const expired = byOutcome('expired');
  const failedSends = byOutcome('failed');

  return {
    missedCalls: calls.length,
    textsSent: missedCallTexts + bookingLinksResent,
    missedCallTexts,
    bookingLinksResent,
    replies: replies.length,
    repliesBook: replies.filter((reply) => reply.intent === 'book').length,
    repliesOptOut: replies.filter((reply) => reply.intent === 'opt_out').length,
    repliesOther: replies.filter((reply) => reply.intent === 'other').length,
    bookingsClicked: data.calls.filter((call) => inWindow(call.clicked_at)).length,
    optOuts: Number(data.opt_outs ?? 0),
    heldForMorning,
    notTexted: repeatCallers + optedOutCallers + noCallerId + foreignNumbers + expired,
    repeatCallers,
    optedOutCallers,
    noCallerId,
    foreignNumbers,
    expired,
    failedSends,
    stuckSends: byOutcome('claimed') + byOutcome('sending'),
    duplicateCallbacks: calls.reduce((sum, call) => sum + Math.max(0, Number(call.callback_count ?? 1) - 1), 0),
    managerAlerts: replies.filter((reply) => ['manager_alerted', 'blocked_opted_out', 'link_failed'].includes(reply.action)).length
      + byOutcome('failed'),
  };
};

const notTextedDetail = (counts: ReportCounts): string => {
  const parts = [
    counts.repeatCallers > 0 ? plural(counts.repeatCallers, 'repeat caller already texted', 'repeat callers already texted') : '',
    counts.optedOutCallers > 0 ? plural(counts.optedOutCallers, 'opted out', 'opted out') : '',
    counts.noCallerId > 0 ? plural(counts.noCallerId, 'no caller ID', 'no caller ID') : '',
    counts.foreignNumbers > 0 ? plural(counts.foreignNumbers, 'foreign number', 'foreign numbers') : '',
    counts.expired > 0 ? plural(counts.expired, 'too old to send', 'too old to send') : '',
  ].filter((part) => part !== '');
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
};

export const buildDailyReport = (
  data: ReportData,
  window: ReportWindow,
  business: string,
  quietEnd: string,
): DailyReport => {
  const counts = countReport(data, window);
  const lines = [
    `${business}, missed call report for ${window.label}`,
    '',
    `Missed calls: ${counts.missedCalls}`,
    `Texts sent: ${counts.textsSent} (${plural(counts.missedCallTexts, 'missed call text', 'missed call texts')}, `
      + `${plural(counts.bookingLinksResent, 'booking link', 'booking links')} on request)`,
    `Replies: ${counts.replies} (${counts.repliesBook} YES or BOOK, ${counts.repliesOptOut} opt out, `
      + `${counts.repliesOther} other)`,
    `Bookings clicked: ${counts.bookingsClicked}`,
    `Opt outs: ${counts.optOuts}`,
    '',
    `Waiting for ${quietEnd} (quiet hours): ${counts.heldForMorning}`,
    `Not texted: ${counts.notTexted}${notTextedDetail(counts)}`,
    `Failed sends: ${counts.failedSends}${counts.failedSends > 0 ? ' (manager alerted, call them back)' : ''}`,
    ...(counts.stuckSends > 0 ? [`Stuck sends: ${counts.stuckSends} (check the n8n executions list)`] : []),
    `Duplicate callbacks ignored: ${counts.duplicateCallbacks}`,
    `Manager alerts: ${counts.managerAlerts}`,
    '',
    'Counts only. No names or numbers in this report.',
  ];
  return {
    date: window.date,
    subject: `${business} missed call report, ${window.label}`,
    text: lines.join('\n'),
    counts,
  };
};
