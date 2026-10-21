import { describe, expect, it } from 'vitest';
import { configFlag, configNumber, configString, readRecord } from '../src/logic/config.ts';

describe('config readers', () => {
  it('reads trimmed strings and fails loudly when one is missing', () => {
    expect(configString({ name: ' Harbour Slice ' }, 'name')).toBe('Harbour Slice');
    expect(() => configString({ name: '' }, 'name')).toThrow(/Config is missing "name"/);
    expect(() => configString({}, 'name')).toThrow(/Open the Config node/);
  });

  it('reads numbers, including numbers typed as text', () => {
    expect(configNumber({ hours: 16 }, 'hours')).toBe(16);
    expect(configNumber({ hours: '16' }, 'hours')).toBe(16);
    expect(() => configNumber({ hours: 'soon' }, 'hours')).toThrow(/must be a number/);
    expect(() => configNumber({ hours: '' }, 'hours')).toThrow(/must be a number/);
  });

  it('only treats true and "true" as on', () => {
    expect(configFlag({ on: true }, 'on')).toBe(true);
    expect(configFlag({ on: 'true' }, 'on')).toBe(true);
    expect(configFlag({ on: 1 }, 'on')).toBe(false);
    expect(configFlag({}, 'on')).toBe(false);
  });

  it('reads objects and replaces anything else with an empty object', () => {
    expect(readRecord({ a: 1 })).toEqual({ a: 1 });
    expect(readRecord([1])).toEqual({});
    expect(readRecord(null)).toEqual({});
    expect(readRecord('x')).toEqual({});
  });
});
