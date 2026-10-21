// Code node "Build report" in workflow 3. Input: the row from sql/daily-report.sql and the report window.
import { configString } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';
import { buildDailyReport } from '../logic/report.ts';
import type { ReportCallRow, ReportCounts, ReportReplyRow } from '../logic/report.ts';

export interface BuildReportOut {
  date: string;
  subject: string;
  text: string;
  counts: ReportCounts;
  alert_subject: string;
  alert_text: string;
}

const asRows = <T>(value: unknown): T[] => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
};

export const buildReportNode = (
  row: Readonly<Record<string, unknown>>,
  window: Readonly<Record<string, unknown>>,
  cfg: ConfigItem,
): BuildReportOut => {
  const report = buildDailyReport(
    {
      calls: asRows<ReportCallRow>(row.calls),
      replies: asRows<ReportReplyRow>(row.replies),
      opt_outs: row.opt_outs,
    },
    {
      date: String(window.date),
      label: String(window.label),
      startIso: String(window.start_iso),
      endIso: String(window.end_iso),
    },
    configString(cfg, 'business_name'),
    configString(cfg, 'quiet_end'),
  );
  return { ...report, alert_subject: report.subject, alert_text: report.text };
};
