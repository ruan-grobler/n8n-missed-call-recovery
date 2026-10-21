// Code node "Failure alert" in workflow 1. One alert per text that Twilio refused (the dead letter path).
import { failedSmsAlert } from '../logic/alerts.ts';
import type { Alert } from '../logic/alerts.ts';
import { toIso } from '../logic/clock.ts';
import { configString } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';

export interface FailureAlertOut extends Alert {
  call_key: string;
}

export const failureAlert = (rows: readonly Readonly<Record<string, unknown>>[], cfg: ConfigItem): FailureAlertOut[] =>
  rows
    .filter((row) => row.outcome === 'failed' && typeof row.caller_e164 === 'string')
    .map((row) => ({
      call_key: String(row.call_key),
      ...failedSmsAlert(
        configString(cfg, 'business_name'),
        String(row.caller_e164),
        toIso(row.called_at) ?? '',
        configString(cfg, 'timezone'),
        String(row.last_error ?? 'unknown error'),
      ),
    }));
