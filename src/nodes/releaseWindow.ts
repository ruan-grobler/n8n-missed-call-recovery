// Code node "Release window" in workflow 1. Decides whether queued texts may go out right now.
import { hoursBefore, isQuietHours, resolveNow } from '../logic/clock.ts';
import { configFlag, configNumber, configString, readRecord } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';

export interface ReleaseWindowOut {
  release: boolean;
  reason: string;
  now_iso: string;
  stale_before: string;
}

export const releaseWindow = (item: ConfigItem, realNowIso: string): ReleaseWindowOut => {
  const headers = readRecord(item.headers);
  const nowIso = resolveNow(realNowIso, configFlag(item, 'test_clock_enabled'), headers['x-hs-test-clock']);
  const quiet = isQuietHours(nowIso, configString(item, 'timezone'), configString(item, 'quiet_start'), configString(item, 'quiet_end'));
  return {
    release: !quiet,
    reason: quiet ? 'still quiet hours, nothing goes out' : 'outside quiet hours, due texts can go out',
    now_iso: nowIso,
    stale_before: hoursBefore(nowIso, configNumber(item, 'stale_after_hours')),
  };
};
