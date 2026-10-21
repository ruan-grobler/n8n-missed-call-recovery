import { describe, expect, it } from 'vitest';
import { formatPhoneForPeople, isAllowedCountry, normalisePhone, parsePrefixList } from '../src/logic/phone.ts';

describe('normalisePhone', () => {
  it.each([
    ['+27000000012', '+27000000012'],
    ['0000000012', '+27000000012'],
    ['27000000013', '+27000000013'],
    ['0027000000023', '+27000000023'],
    ['+27 00 000 0012', '+27000000012'],
    ['+27 (0)00 000 0018', '+27000000018'],
    ['+270000000018', '+27000000018'],
    ['sip:+27000000025@pbx.example.com', '+27000000025'],
    ['tel:+27000000026', '+27000000026'],
    ['+44 000 000 0000', '+440000000000'],
  ])('turns %s into %s', (raw, e164) => {
    expect(normalisePhone(raw)).toEqual({ ok: true, e164 });
  });

  it.each(['anonymous', 'Restricted', '+266696687', '266696687', '', '  ', undefined, null])('treats %s as a withheld caller ID', (raw) => {
    expect(normalisePhone(raw)).toEqual({ ok: false, issue: 'withheld' });
  });

  it.each(['12345', 'not a number', '+0123456789', '00012345678'])('rejects %s', (raw) => {
    expect(normalisePhone(raw)).toEqual({ ok: false, issue: 'invalid' });
  });

  it('supports another default country code', () => {
    expect(normalisePhone('0000000012', '44')).toEqual({ ok: true, e164: '+44000000012' });
    expect(normalisePhone('44000000000', '44')).toEqual({ ok: true, e164: '+44000000000' });
  });
});

describe('country rules', () => {
  it('parses a comma separated prefix list and drops junk', () => {
    expect(parsePrefixList(' +27, +264 ,27,abc,')).toEqual(['+27', '+264']);
    expect(parsePrefixList(undefined)).toEqual([]);
  });

  it('allows numbers that match a prefix, and everything when the list is empty', () => {
    expect(isAllowedCountry('+27000000001', ['+27'])).toBe(true);
    expect(isAllowedCountry('+440000000000', ['+27'])).toBe(false);
    expect(isAllowedCountry('+440000000000', [])).toBe(true);
  });
});

describe('formatPhoneForPeople', () => {
  it('spaces South African numbers and leaves others alone', () => {
    expect(formatPhoneForPeople('+27000000035')).toBe('+27 00 000 0035');
    expect(formatPhoneForPeople('+440000000000')).toBe('+440000000000');
  });
});
