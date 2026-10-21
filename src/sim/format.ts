// Plain text output for the demo and the e2e run.
import { DateTime } from 'luxon';
import { CALLS, DAY, PROLOGUE_CALL } from '../../scenarios/harbour-slice-day.ts';
import type { ScenarioResult } from './runner.ts';
import { TIMEZONE, callKeyFor } from './runner.ts';

// Assumptions for the one estimate in the output. They are not measured.
export const ESTIMATE = { tapsPerOrder: 3, averageOrderZar: 250 } as const;

const local = (iso: string | null | undefined, format: string): string =>
  iso ? DateTime.fromISO(iso).setZone(TIMEZONE).toFormat(format) : '';

const pad = (text: string, width: number): string => text.padEnd(width).slice(0, width);

export const formatCallTable = (result: ScenarioResult): string[] => {
  const rows = new Map(result.callRows.map((row) => [row.call_key, row]));
  const header = `${pad('Call', 5)}${pad('When', 14)}${pad('Status', 11)}${pad('Caller ID as received', 34)}${pad('Outcome', 16)}Texted`;
  const lines = [PROLOGUE_CALL, ...CALLS].map((item) => {
    const row = rows.get(callKeyFor(item));
    const token = row?.link_token ?? '';
    const text = result.sms.find((sms) => token !== '' && sms.body.includes(`t=${token}`) && sms.body.includes('sorry we missed'));
    const texted = text?.simulatedAt ? local(text.simulatedAt, 'dd LLL HH:mm') : '-';
    return `${pad(item.id, 5)}${pad(local(item.at, 'dd LLL HH:mm'), 14)}${pad(item.status, 11)}${pad(item.from, 34)}${pad(row?.outcome ?? 'missing', 16)}${texted}`;
  });
  return [header, ...lines];
};

export const formatChecks = (result: ScenarioResult): string[] =>
  result.checks.map((check) => `${check.passed ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);

export const beforeAfter = (result: ScenarioResult): string[] => {
  const dayCalls = CALLS.filter((item) => item.at.startsWith(DAY));
  const rows = new Map(result.callRows.map((row) => [row.call_key, row]));
  const texted = dayCalls.filter((item) => rows.get(callKeyFor(item))?.outcome === 'sent').length;
  const nextMorning = dayCalls.filter((item) => item.queuedUntil === 'next 08:00').length;
  const taps = result.report.counts.bookingsClicked;
  const orders = Math.round(taps / ESTIMATE.tapsPerOrder);
  return [
    `Before (synthetic baseline, no automation): ${dayCalls.length} missed calls, 0 follow up texts.`,
    `After (same synthetic day, this kit): ${texted} of ${dayCalls.length} missed callers got a booking link text `
      + `(${texted - nextMorning} the same day, ${nextMorning} at 08:00 the next morning).`,
    `  ${taps} of them tapped the booking link. ${result.metrics.quietHourTexts} texts in quiet hours, `
      + `${result.metrics.extraTexts} double texts, ${result.metrics.textsAfterOptOut} texts after an opt out.`,
    `Estimate, not measured: if 1 in ${ESTIMATE.tapsPerOrder} taps becomes an order worth R${ESTIMATE.averageOrderZar}, `
      + `that is about ${orders} orders, about R${(orders * ESTIMATE.averageOrderZar).toLocaleString('en-US')} for this one day.`,
  ];
};

export const formatResult = (title: string, result: ScenarioResult): string => {
  const passed = result.checks.filter((check) => check.passed).length;
  const sample = result.sms.find((sms) => sms.body.includes('sorry we missed'));
  return [
    title,
    '='.repeat(title.length),
    `Driver: ${result.driver}`,
    'Scenario: scenarios/harbour-slice-day.ts (synthetic data, fake numbers, fictional business)',
    `Events replayed: ${result.requests} (calls, duplicate callbacks, answered calls, replies, link taps, 15 minute release ticks, the 08:00 report)`,
    '',
    'Example text a missed caller receives:',
    `  ${sample?.body ?? '(none)'}`,
    '',
    'What happened to every call',
    ...formatCallTable(result),
    '',
    'Daily report sent to Slack and email at 08:00 the next morning',
    '-'.repeat(62),
    ...result.report.text.split('\n'),
    '-'.repeat(62),
    '',
    `Checks against the hand written answer key: ${passed} of ${result.checks.length} passed`,
    ...formatChecks(result),
    '',
    ...beforeAfter(result),
    '',
  ].join('\n');
};
