import { describe, expect, it } from 'vitest';
import {
  daysBefore,
  hoursBefore,
  isQuietHours,
  isWithin,
  localTimeLabel,
  minutesBetween,
  nextQuietEnd,
  parseTwilioTimestamp,
  reportWindow,
  resolveNow,
  toIso,
} from '../src/logic/clock.ts';

const TZ = 'Africa/Johannesburg';
const sast = (hhmm: string, day = '2026-10-16'): string => new Date(`${day}T${hhmm}:00+02:00`).toISOString();

describe('resolveNow', () => {
  it('uses the real clock unless the test clock is switched on', () => {
    expect(resolveNow('2026-10-21T10:00:00.000+02:00', false, '2026-10-16T12:00:00+02:00')).toBe('2026-10-21T08:00:00.000Z');
    expect(resolveNow('2026-10-21T10:00:00.000+02:00', 'true', '2026-10-16T12:00:00+02:00')).toBe('2026-10-21T08:00:00.000Z');
  });

  it('uses a valid test clock header when switched on', () => {
    expect(resolveNow('2026-10-21T10:00:00.000+02:00', true, '2026-10-16T12:00:00+02:00')).toBe('2026-10-16T10:00:00.000Z');
  });

  it('ignores an empty or broken header', () => {
    expect(resolveNow('2026-10-21T08:00:00.000Z', true, '')).toBe('2026-10-21T08:00:00.000Z');
    expect(resolveNow('2026-10-21T08:00:00.000Z', true, 'yesterday')).toBe('2026-10-21T08:00:00.000Z');
    expect(resolveNow('2026-10-21T08:00:00.000Z', true, ['2026-10-16T12:00:00Z'])).toBe('2026-10-21T08:00:00.000Z');
  });
});

describe('isQuietHours with 21:00 to 08:00', () => {
  it.each([
    ['20:59', false],
    ['21:00', true],
    ['23:59', true],
    ['00:00', true],
    ['07:59', true],
    ['08:00', false],
    ['12:30', false],
  ])('%s is quiet: %s', (hhmm, quiet) => {
    expect(isQuietHours(sast(hhmm), TZ, '21:00', '08:00')).toBe(quiet);
  });

  it('handles a window that does not wrap midnight', () => {
    expect(isQuietHours(sast('13:30'), TZ, '13:00', '14:00')).toBe(true);
    expect(isQuietHours(sast('14:00'), TZ, '13:00', '14:00')).toBe(false);
  });

  it('treats equal start and end as no quiet hours', () => {
    expect(isQuietHours(sast('03:00'), TZ, '08:00', '08:00')).toBe(false);
  });

  it('rejects a badly written time', () => {
    expect(() => isQuietHours(sast('03:00'), TZ, '9pm', '08:00')).toThrow(/like 21:00/);
  });
});

describe('nextQuietEnd', () => {
  it('moves an evening call to 08:00 the next day', () => {
    expect(nextQuietEnd(sast('21:06'), TZ, '08:00')).toBe(sast('08:00', '2026-10-17'));
  });

  it('keeps an early morning call on the same day', () => {
    expect(nextQuietEnd(sast('00:41'), TZ, '08:00')).toBe(sast('08:00'));
  });

  it('never returns now itself', () => {
    expect(nextQuietEnd(sast('08:00'), TZ, '08:00')).toBe(sast('08:00', '2026-10-17'));
  });
});

describe('parseTwilioTimestamp', () => {
  it('reads RFC 2822 timestamps', () => {
    expect(parseTwilioTimestamp('Fri, 16 Oct 2026 10:05:00 +0000')).toBe('2026-10-16T10:05:00.000Z');
  });

  it('returns null for missing or broken values', () => {
    expect(parseTwilioTimestamp(undefined)).toBeNull();
    expect(parseTwilioTimestamp('  ')).toBeNull();
    expect(parseTwilioTimestamp('last Friday')).toBeNull();
  });
});

describe('reportWindow', () => {
  it('covers yesterday in the business timezone by default', () => {
    const window = reportWindow(sast('08:00', '2026-10-17'), TZ);
    expect(window).toEqual({
      date: '2026-10-16',
      label: 'Friday 16 October 2026',
      startIso: '2026-10-15T22:00:00.000Z',
      endIso: '2026-10-16T22:00:00.000Z',
    });
  });

  it('uses a requested date, and ignores a malformed one', () => {
    expect(reportWindow(sast('08:00', '2026-10-17'), TZ, '2026-10-09').date).toBe('2026-10-09');
    expect(reportWindow(sast('08:00', '2026-10-17'), TZ, '16/10/2026').date).toBe('2026-10-16');
    expect(reportWindow(sast('08:00', '2026-10-17'), TZ, '2026-13-45').date).toBe('2026-10-16');
  });
});

describe('small helpers', () => {
  it('converts Dates and strings to UTC ISO, and empty values to null', () => {
    expect(toIso(new Date('2026-10-16T10:00:00Z'))).toBe('2026-10-16T10:00:00.000Z');
    expect(toIso('2026-10-16T12:00:00+02:00')).toBe('2026-10-16T10:00:00.000Z');
    expect(toIso('')).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso('not a date')).toBeNull();
  });

  it('checks a half open window', () => {
    expect(isWithin('2026-10-15T22:00:00.000Z', '2026-10-15T22:00:00.000Z', '2026-10-16T22:00:00.000Z')).toBe(true);
    expect(isWithin('2026-10-16T22:00:00.000Z', '2026-10-15T22:00:00.000Z', '2026-10-16T22:00:00.000Z')).toBe(false);
    expect(isWithin(null, '2026-10-15T22:00:00.000Z', '2026-10-16T22:00:00.000Z')).toBe(false);
  });

  it('does minute and day arithmetic', () => {
    expect(minutesBetween(sast('12:05'), sast('12:20'))).toBe(15);
    expect(hoursBefore(sast('08:00'), 16)).toBe(sast('16:00', '2026-10-15'));
    expect(daysBefore(sast('08:00'), 90)).toBe(sast('08:00', '2026-07-18'));
    expect(localTimeLabel(sast('19:12'), TZ)).toBe('19:12');
  });
});
