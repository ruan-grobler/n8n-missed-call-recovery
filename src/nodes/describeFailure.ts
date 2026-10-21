// Code node "Describe failure" in workflow 1. Turns n8n's raw HTTP error into one readable line for the log row.
import { describeTwilioError } from '../logic/alerts.ts';

export interface DescribeFailureOut {
  call_key: string;
  caller_e164: string;
  error_text: string;
}

export const describeFailure = (
  errorItem: Readonly<Record<string, unknown>>,
  prepared: Readonly<Record<string, unknown>>,
): DescribeFailureOut => ({
  call_key: String(prepared.call_key ?? ''),
  caller_e164: String(prepared.sms_to ?? ''),
  error_text: describeTwilioError({ error: errorItem.error, details: errorItem.details }),
});
