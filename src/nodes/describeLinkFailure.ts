// Code node "Describe link failure" in workflow 2. Readable error text for the reply log row.
import { describeTwilioError } from '../logic/alerts.ts';

export interface DescribeLinkFailureOut {
  message_sid: string;
  error_text: string;
}

export const describeLinkFailure = (
  errorItem: Readonly<Record<string, unknown>>,
  decision: Readonly<Record<string, unknown>>,
): DescribeLinkFailureOut => ({
  message_sid: String(decision.message_sid ?? ''),
  error_text: describeTwilioError({ error: errorItem.error, details: errorItem.details }),
});
