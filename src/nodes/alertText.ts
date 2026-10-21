// Code node "Alert text" in workflow 2. Input: a reply log row (action, from_e164, detail) and the read reply.
import { linkFailedAlert, replyAlert } from '../logic/alerts.ts';
import type { Alert } from '../logic/alerts.ts';
import { configString } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';

export const alertText = (
  row: Readonly<Record<string, unknown>>,
  reply: Readonly<Record<string, unknown>>,
  cfg: ConfigItem,
): Alert => {
  const business = configString(cfg, 'business_name');
  const from = String(row.from_e164 ?? reply.from_e164 ?? '');
  if (row.action === 'link_failed') {
    return linkFailedAlert(business, from, String(row.detail ?? 'unknown error'));
  }
  return replyAlert(
    business,
    from,
    String(reply.now_iso),
    configString(cfg, 'timezone'),
    String(reply.preview ?? ''),
    row.action === 'blocked_opted_out',
  );
};
