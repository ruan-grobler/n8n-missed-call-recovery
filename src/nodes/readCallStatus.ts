// Code node "Read call status" in workflow 1. Input: the Config item, which carries the webhook request.
import { parseStatusCallback, parseStatusList } from '../logic/callStatus.ts';
import { resolveNow } from '../logic/clock.ts';
import { configFlag, configString, readRecord } from '../logic/config.ts';
import type { ConfigItem } from '../logic/config.ts';
import { parsePrefixList } from '../logic/phone.ts';

export interface ReadCallStatusOut {
  is_missed: boolean;
  ignore_reason: string | null;
  call_key: string;
  call_sid: string;
  parent_call_sid: string | null;
  call_status: string;
  caller_e164: string | null;
  caller_issue: string | null;
  called_at: string;
  now_iso: string;
}

export const readCallStatus = (item: ConfigItem, realNowIso: string): ReadCallStatusOut => {
  const headers = readRecord(item.headers);
  const nowIso = resolveNow(realNowIso, configFlag(item, 'test_clock_enabled'), headers['x-hs-test-clock']);
  const call = parseStatusCallback(readRecord(item.body), {
    missedStatuses: parseStatusList(configString(item, 'missed_statuses')),
    allowedPrefixes: parsePrefixList(configString(item, 'allowed_country_prefixes')),
    nowIso,
  });
  return {
    is_missed: call.isMissed,
    ignore_reason: call.ignoreReason,
    call_key: call.callKey,
    call_sid: call.callSid,
    parent_call_sid: call.parentCallSid,
    call_status: call.callStatus,
    caller_e164: call.callerE164,
    caller_issue: call.callerIssue,
    called_at: call.calledAtIso,
    now_iso: nowIso,
  };
};
