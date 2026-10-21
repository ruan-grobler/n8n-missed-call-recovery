import { describe, expect, it } from 'vitest';
import { decideMissedCall } from '../src/logic/decide.ts';

const at = (hhmm: string, day = '2026-10-16'): string => new Date(`${day}T${hhmm}:00+02:00`).toISOString();
const options = (hhmm: string, cooldown = 360): Parameters<typeof decideMissedCall>[2] => ({
  nowIso: at(hhmm), timezone: 'Africa/Johannesburg', quietStart: '21:00', quietEnd: '08:00', repeatCooldownMinutes: cooldown,
});
const fresh = { callback_count: 1, opted_out: false, last_sent_at: null, has_queued: false };

describe('decideMissedCall', () => {
  it('sends during opening hours', () => {
    expect(decideMissedCall(fresh, null, options('12:00'))).toEqual({ action: 'send', reason: 'missed call, outside quiet hours' });
  });

  it('queues during quiet hours until 08:00', () => {
    expect(decideMissedCall(fresh, null, options('21:06'))).toMatchObject({ action: 'queue', sendAfterIso: at('08:00', '2026-10-17') });
    expect(decideMissedCall(fresh, null, options('00:41'))).toMatchObject({ action: 'queue', sendAfterIso: at('08:00') });
  });

  it('never acts twice on the same call', () => {
    expect(decideMissedCall({ ...fresh, callback_count: 2 }, null, options('12:00')).action).toBe('duplicate');
    expect(decideMissedCall({ ...fresh, callback_count: '3' }, null, options('12:00')).action).toBe('duplicate');
  });

  it('skips withheld, unreadable and foreign numbers', () => {
    expect(decideMissedCall(fresh, 'withheld', options('12:00'))).toMatchObject({ action: 'skip', outcome: 'no_caller_id' });
    expect(decideMissedCall(fresh, 'invalid', options('12:00'))).toMatchObject({ action: 'skip', outcome: 'no_caller_id' });
    expect(decideMissedCall(fresh, 'foreign', options('12:00'))).toMatchObject({ action: 'skip', outcome: 'foreign_number' });
  });

  it('never texts an opted out number, even when it would otherwise be a repeat caller', () => {
    expect(decideMissedCall({ ...fresh, opted_out: true, has_queued: true }, null, options('12:00')))
      .toMatchObject({ action: 'skip', outcome: 'opted_out' });
  });

  it('skips repeat callers inside the cooldown or with a text already waiting', () => {
    expect(decideMissedCall({ ...fresh, has_queued: true }, null, options('22:40'))).toMatchObject({ outcome: 'repeat_caller' });
    expect(decideMissedCall({ ...fresh, last_sent_at: at('12:05') }, null, options('12:20'))).toMatchObject({ outcome: 'repeat_caller' });
  });

  it('texts again once the cooldown has passed, or when the cooldown is off', () => {
    expect(decideMissedCall({ ...fresh, last_sent_at: at('05:00') }, null, options('12:00')).action).toBe('send');
    expect(decideMissedCall({ ...fresh, last_sent_at: at('11:59') }, null, options('12:00', 0)).action).toBe('send');
  });
});
