// Code node "Report window" in workflow 3. Yesterday in the business timezone, or the date asked for.
import { daysBefore, reportWindow, resolveNow } from '../logic/clock.ts';
import { configFlag, configNumber, configString, readRecord } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';

export interface ReportWindowOut {
  date: string;
  label: string;
  start_iso: string;
  end_iso: string;
  now_iso: string;
  retention_before: string;
}

export const reportWindowNode = (item: ConfigItem, realNowIso: string): ReportWindowOut => {
  const headers = readRecord(item.headers);
  const nowIso = resolveNow(realNowIso, configFlag(item, 'test_clock_enabled'), headers['x-hs-test-clock']);
  const window = reportWindow(nowIso, configString(item, 'timezone'), readRecord(item.body).date);
  return {
    date: window.date,
    label: window.label,
    start_iso: window.startIso,
    end_iso: window.endIso,
    now_iso: nowIso,
    retention_before: daysBefore(nowIso, configNumber(item, 'retention_days')),
  };
};
