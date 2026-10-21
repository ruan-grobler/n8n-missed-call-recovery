// Code node "Decide" in workflow 1. Input: the claimed row, the parsed call and the Config item.
import { decideMissedCall } from '../logic/decide.ts';
import type { CallerIssue } from '../logic/callStatus.ts';
import { configNumber, configString } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';

export interface DecideCallOut {
  action: 'duplicate' | 'skip' | 'queue' | 'send';
  outcome: string | null;
  send_after: string | null;
  reason: string;
  call_key: string;
  caller_e164: string | null;
  link_token: string;
  now_iso: string;
}

const asIssue = (value: unknown): CallerIssue =>
  value === 'withheld' || value === 'invalid' || value === 'foreign' ? value : null;

export const decideCall = (
  claim: Readonly<Record<string, unknown>>,
  call: Readonly<Record<string, unknown>>,
  cfg: ConfigItem,
): DecideCallOut => {
  const nowIso = String(call.now_iso);
  const decision = decideMissedCall(
    {
      callback_count: claim.callback_count,
      opted_out: claim.opted_out,
      last_sent_at: claim.last_sent_at,
      has_queued: claim.has_queued,
    },
    asIssue(call.caller_issue),
    {
      nowIso,
      timezone: configString(cfg, 'timezone'),
      quietStart: configString(cfg, 'quiet_start'),
      quietEnd: configString(cfg, 'quiet_end'),
      repeatCooldownMinutes: configNumber(cfg, 'repeat_cooldown_minutes'),
    },
  );
  return {
    action: decision.action,
    outcome: decision.action === 'skip' ? decision.outcome : null,
    send_after: decision.action === 'queue' ? decision.sendAfterIso : null,
    reason: decision.reason,
    call_key: String(claim.call_key ?? call.call_key),
    caller_e164: typeof claim.caller_e164 === 'string' ? claim.caller_e164 : null,
    link_token: String(claim.link_token ?? ''),
    now_iso: nowIso,
  };
};
