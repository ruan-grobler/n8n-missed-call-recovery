// Code node "Read click" in workflow 2. The tracked link carries ?t=<token>. A bad token still redirects.
import { resolveNow } from '../logic/clock.ts';
import { configFlag, readRecord } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';

export interface ReadClickOut {
  token: string;
  valid: boolean;
  now_iso: string;
}

export const readClick = (item: ConfigItem, realNowIso: string): ReadClickOut => {
  const headers = readRecord(item.headers);
  const token = String(readRecord(item.query).t ?? '').trim().toLowerCase();
  return {
    token,
    valid: /^[a-f0-9]{12}$/.test(token),
    now_iso: resolveNow(realNowIso, configFlag(item, 'test_clock_enabled'), headers['x-hs-test-clock']),
  };
};
