// Time helpers. Every decision takes "now" as an input so tests and the demo can replay a whole day.
import { DateTime } from 'luxon';

const toUtcIso = (value: DateTime): string => value.toUTC().toISO() ?? '';

// Uses the x-hs-test-clock header only when Config has test_clock_enabled set to true.
// It ships switched off. The e2e harness switches it on to replay a synthetic day.
export const resolveNow = (realNowIso: string, testClockEnabled: unknown, testClockHeader: unknown): string => {
  if (testClockEnabled === true && typeof testClockHeader === 'string' && testClockHeader.trim() !== '') {
    const fake = DateTime.fromISO(testClockHeader.trim(), { setZone: true });
    if (fake.isValid) {
      return toUtcIso(fake);
    }
  }
  return toUtcIso(DateTime.fromISO(realNowIso, { setZone: true }));
};

// Accepts an ISO string or a Date, which is what Postgres drivers hand back for timestamptz.
export const toIso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = value instanceof Date
    ? DateTime.fromJSDate(value)
    : DateTime.fromISO(String(value), { setZone: true });
  return parsed.isValid ? toUtcIso(parsed) : null;
};

export const minutesBetween = (fromIso: string, toIsoValue: string): number =>
  DateTime.fromISO(toIsoValue).diff(DateTime.fromISO(fromIso), 'minutes').minutes;

const minuteOfDay = (hhmm: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) {
    throw new Error(`Expected a time like 21:00, got "${hhmm}"`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

// Quiet hours can wrap midnight, for example 21:00 to 08:00. The end minute is not quiet.
export const isQuietHours = (nowIso: string, timezone: string, quietStart: string, quietEnd: string): boolean => {
  const local = DateTime.fromISO(nowIso).setZone(timezone);
  const minute = local.hour * 60 + local.minute;
  const start = minuteOfDay(quietStart);
  const end = minuteOfDay(quietEnd);
  if (start === end) {
    return false;
  }
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
};

// The next time the clock reads quietEnd in the business timezone, strictly after now.
export const nextQuietEnd = (nowIso: string, timezone: string, quietEnd: string): string => {
  const local = DateTime.fromISO(nowIso).setZone(timezone);
  const minute = minuteOfDay(quietEnd);
  let target = local.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 });
  if (target <= local) {
    target = target.plus({ days: 1 });
  }
  return toUtcIso(target);
};

// Twilio sends Timestamp as RFC 2822, for example "Fri, 16 Oct 2026 10:05:00 +0000".
export const parseTwilioTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = DateTime.fromRFC2822(value.trim());
  return parsed.isValid ? toUtcIso(parsed) : null;
};

export interface ReportWindow {
  date: string;
  label: string;
  startIso: string;
  endIso: string;
}

// The report covers one calendar day in the business timezone. By default that is yesterday.
export const reportWindow = (nowIso: string, timezone: string, requestedDate?: unknown): ReportWindow => {
  const asked = typeof requestedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? DateTime.fromISO(requestedDate, { zone: timezone })
    : null;
  const day = asked && asked.isValid
    ? asked.startOf('day')
    : DateTime.fromISO(nowIso).setZone(timezone).startOf('day').minus({ days: 1 });
  return {
    date: day.toISODate() ?? '',
    label: day.toFormat('cccc d LLLL yyyy'),
    startIso: toUtcIso(day),
    endIso: toUtcIso(day.plus({ days: 1 })),
  };
};

export const isWithin = (iso: string | null, startIso: string, endIso: string): boolean => {
  if (!iso) {
    return false;
  }
  const at = DateTime.fromISO(iso).toMillis();
  return at >= DateTime.fromISO(startIso).toMillis() && at < DateTime.fromISO(endIso).toMillis();
};

export const localTimeLabel = (iso: string, timezone: string): string =>
  DateTime.fromISO(iso).setZone(timezone).toFormat('HH:mm');

export const hoursBefore = (iso: string, hours: number): string =>
  toUtcIso(DateTime.fromISO(iso).minus({ hours }));

export const daysBefore = (iso: string, days: number): string =>
  toUtcIso(DateTime.fromISO(iso).minus({ days }));
