import { describe, expect, it } from 'vitest';
import { parseStatusCallback, parseStatusList } from '../src/logic/callStatus.ts';

const options = { missedStatuses: ['no-answer', 'busy', 'failed'], allowedPrefixes: ['+27'], nowIso: '2026-10-16T10:00:00.000Z' };
const SID = 'CA00000000000000000000000000000001';

describe('parseStatusCallback', () => {
  it('reads a missed call', () => {
    const call = parseStatusCallback({ CallSid: SID, From: '+27000000001', CallStatus: 'no-answer', Timestamp: 'Fri, 16 Oct 2026 10:05:00 +0000' }, options);
    expect(call).toEqual({
      isMissed: true,
      ignoreReason: null,
      callKey: SID,
      callSid: SID,
      parentCallSid: null,
      callStatus: 'no-answer',
      callerE164: '+27000000001',
      callerIssue: null,
      calledAtIso: '2026-10-16T10:05:00.000Z',
    });
  });

  it('keys two handset callbacks on the parent call', () => {
    const call = parseStatusCallback({ CallSid: SID, ParentCallSid: 'CAparent', From: '+27000000001', CallStatus: 'busy' }, options);
    expect(call.callKey).toBe('CAparent');
    expect(call.calledAtIso).toBe(options.nowIso);
  });

  it('ignores answered calls and callbacks without a CallSid', () => {
    expect(parseStatusCallback({ CallSid: SID, From: '+27000000001', CallStatus: 'completed' }, options))
      .toMatchObject({ isMissed: false, ignoreReason: 'status completed is not a missed call' });
    expect(parseStatusCallback({ From: '+27000000001', CallStatus: 'no-answer' }, options))
      .toMatchObject({ isMissed: false, ignoreReason: 'no CallSid in the callback' });
    expect(parseStatusCallback({ CallSid: 'CA bad sid!', CallStatus: 'no-answer' }, options).isMissed).toBe(false);
    expect(parseStatusCallback({ CallSid: SID }, options).ignoreReason).toBe('status empty is not a missed call');
  });

  it('accepts a Dial action callback (DialCallStatus) and the Caller field', () => {
    const call = parseStatusCallback({ CallSid: SID, Caller: '+27000000002', DialCallStatus: 'NO-ANSWER' }, options);
    expect(call).toMatchObject({ isMissed: true, callerE164: '+27000000002', callStatus: 'no-answer' });
  });

  it('flags withheld and foreign callers but still records the miss', () => {
    expect(parseStatusCallback({ CallSid: SID, From: 'anonymous', CallStatus: 'no-answer' }, options))
      .toMatchObject({ isMissed: true, callerE164: null, callerIssue: 'withheld' });
    expect(parseStatusCallback({ CallSid: SID, From: '+440000000000', CallStatus: 'no-answer' }, options))
      .toMatchObject({ isMissed: true, callerE164: '+440000000000', callerIssue: 'foreign' });
    expect(parseStatusCallback({ CallSid: SID, From: '123', CallStatus: 'no-answer' }, options))
      .toMatchObject({ isMissed: true, callerIssue: 'invalid' });
  });
});

describe('parseStatusList', () => {
  it('lower cases and trims the Config list', () => {
    expect(parseStatusList(' No-Answer, busy,,FAILED ')).toEqual(['no-answer', 'busy', 'failed']);
    expect(parseStatusList(undefined)).toEqual([]);
  });
});
