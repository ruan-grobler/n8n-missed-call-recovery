// One synthetic Friday at Harbour Slice, a fictional Cape Town pizzeria. All numbers are fake (+27 00 000 00xx).
// Every expected outcome below is written by hand. The demo and the e2e run must reproduce them exactly.

export const SHOP_LINE = '+27000000000';
export const DAY = '2026-10-16';
export const PROLOGUE_DAY = '2026-10-09';
export const NEXT_MORNING = '2026-10-17T08:00:00+02:00';

export type ExpectedOutcome =
  | 'sent'
  | 'repeat_caller'
  | 'no_caller_id'
  | 'opted_out'
  | 'foreign_number'
  | 'failed';

export interface ScenarioCall {
  id: string;
  at: string;
  from: string;
  status: 'no-answer' | 'busy' | 'failed';
  // Set when the shop phone rings on two handsets: both child callbacks share the parent call.
  parent?: string;
  expect: ExpectedOutcome;
  queuedUntil?: string;
  note: string;
}

export interface ScenarioReply {
  id: string;
  at: string;
  from: string;
  body: string;
  expect: 'link_sent' | 'opted_out' | 'manager_alerted' | 'blocked_opted_out';
}

export interface ScenarioClick {
  at: string;
  // The number whose latest SMS link is tapped, or "invalid" for a made up token.
  number: string | 'invalid';
  agent: 'phone' | 'preview-bot';
  counts: boolean;
}

export type ScenarioEvent =
  | { kind: 'call'; at: string; call: ScenarioCall; childSid?: string }
  | { kind: 'duplicate-callback'; at: string; callId: string; secondHandset: boolean }
  | { kind: 'answered'; at: string; from: string }
  | { kind: 'reply'; at: string; reply: ScenarioReply }
  | { kind: 'duplicate-reply'; at: string; replyId: string }
  | { kind: 'click'; at: string; click: ScenarioClick }
  | { kind: 'release'; at: string }
  | { kind: 'report'; at: string; date: string };

const on = (day: string, hhmm: string): string => `${day}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}+02:00`;
const at = (hhmm: string): string => on(DAY, hhmm);

const call = (
  id: string,
  hhmm: string,
  from: string,
  status: ScenarioCall['status'],
  expect: ExpectedOutcome,
  note: string,
  extra: Partial<ScenarioCall> = {},
): ScenarioCall => ({ id, at: at(hhmm), from, status, expect, note, ...extra });

export const PROLOGUE_CALL: ScenarioCall = {
  id: 'P01', at: on(PROLOGUE_DAY, '19:10'), from: '+27000000031', status: 'no-answer', expect: 'sent', note: 'texted last week',
};
export const PROLOGUE_REPLY: ScenarioReply = {
  id: 'R00', at: on(PROLOGUE_DAY, '19:12'), from: '+27000000031', body: 'STOP', expect: 'opted_out',
};

export const CALLS: readonly ScenarioCall[] = [
  call('C01', '00:41', '+27000000001', 'no-answer', 'sent', 'quiet hours, queued until 08:00', { queuedUntil: '08:00' }),
  call('C02', '06:52', '+27000000002', 'no-answer', 'sent', 'quiet hours, queued until 08:00', { queuedUntil: '08:00' }),
  call('C03', '07:48', '+27000000003', 'busy', 'sent', 'quiet hours, queued until 08:00', { queuedUntil: '08:00' }),
  call('C04', '09:12', '+27000000004', 'no-answer', 'sent', 'texted at once'),
  call('C05', '10:30', '+27000000005', 'no-answer', 'sent', 'texted at once'),
  call('C06', '11:42', '+27000000006', 'busy', 'sent', 'lunch rush'),
  call('C07', '11:58', '0000000007', 'no-answer', 'sent', 'local format number, normalised to +27000000007'),
  call('C08', '12:05', '+27000000010', 'no-answer', 'sent', 'Twilio sends this callback twice'),
  call('C09', '12:11', '+27000000008', 'no-answer', 'sent', 'lunch rush'),
  call('C10', '12:20', '+27000000010', 'no-answer', 'repeat_caller', 'same caller as C08, 15 minutes later'),
  call('C11', '12:34', '+27000000011', 'busy', 'sent', 'replies YES'),
  call('C12', '12:47', 'anonymous', 'no-answer', 'no_caller_id', 'withheld caller ID'),
  call('C13', '12:55', '+27000000014', 'no-answer', 'sent', 'replies STOP at 13:02'),
  call('C14', '13:20', '27000000013', 'no-answer', 'sent', 'number without the plus'),
  call('C15', '13:41', '+27000000015', 'failed', 'sent', 'forward to the shop phone failed'),
  call('C16', '14:25', '+27000000016', 'no-answer', 'sent', 'replies Book'),
  call('C17', '15:05', '+27000000017', 'no-answer', 'sent', 'afternoon'),
  call('C18', '16:40', '+27 (0)00 000 0018', 'no-answer', 'sent', 'number with (0) trunk prefix'),
  call('C19', '17:31', '+27000000019', 'busy', 'sent', 'dinner rush'),
  call('C20', '17:44', '+27000000021', 'no-answer', 'sent', 'dinner rush'),
  call('C21', '17:52', '+27000000022', 'busy', 'sent', 'Twilio sends this callback twice, replies yes please'),
  call('C22', '18:03', '+27000000023', 'no-answer', 'sent', 'rings two handsets, two child callbacks', { parent: 'P22' }),
  call('C23', '18:09', '+27000000024', 'busy', 'sent', 'dinner rush'),
  call('C24', '18:15', 'sip:+27000000025@pbx.example.com', 'no-answer', 'sent', 'SIP style caller ID, replies stop texting me'),
  call('C25', '18:22', '+266696687', 'busy', 'no_caller_id', 'Twilio withheld caller ID value'),
  call('C26', '18:30', '+27000000026', 'no-answer', 'sent', 'dinner rush'),
  call('C27', '18:40', '+27000000031', 'no-answer', 'opted_out', 'opted out last week'),
  call('C28', '18:48', '+27000000027', 'busy', 'sent', 'replies BOOK for 4 at 7?'),
  call('C29', '18:55', '+44 000 000 0000', 'no-answer', 'foreign_number', 'foreign number, not texted'),
  call('C30', '19:04', '+27000000028', 'no-answer', 'sent', 'asks about gluten free bases'),
  call('C31', '19:12', '+27000000035', 'no-answer', 'failed', 'landline, Twilio refuses the SMS'),
  call('C32', '19:26', '+27000000029', 'busy', 'sent', 'Twilio sends this callback twice, replies opt out'),
  call('C33', '19:40', '+27000000030', 'no-answer', 'sent', 'running late message'),
  call('C34', '19:55', '+27000000014', 'no-answer', 'opted_out', 'opted out at 13:02 today'),
  call('C35', '20:18', '+27000000032', 'failed', 'sent', 'late dinner'),
  call('C36', '20:52', '+27000000033', 'no-answer', 'sent', 'eight minutes before quiet hours'),
  call('C37', '21:06', '+27000000034', 'no-answer', 'sent', 'quiet hours, waits for 08:00 tomorrow', { queuedUntil: 'next 08:00' }),
  call('C38', '21:48', '+27000000036', 'busy', 'sent', 'quiet hours, waits for 08:00 tomorrow', { queuedUntil: 'next 08:00' }),
  call('C39', '22:10', '+27000000020', 'no-answer', 'sent', 'quiet hours, waits for 08:00 tomorrow', { queuedUntil: 'next 08:00' }),
  call('C40', '22:40', '+27000000020', 'no-answer', 'repeat_caller', 'same caller as C39, a text is already waiting'),
];

export const REPLIES: readonly ScenarioReply[] = [
  { id: 'R01', at: at('12:40'), from: '+27000000011', body: 'YES', expect: 'link_sent' },
  { id: 'R02', at: at('13:02'), from: '+27000000014', body: 'STOP', expect: 'opted_out' },
  { id: 'R03', at: at('14:31'), from: '+27000000016', body: 'Book', expect: 'link_sent' },
  { id: 'R04', at: at('17:58'), from: '+27000000022', body: 'yes please', expect: 'link_sent' },
  { id: 'R05', at: at('18:21'), from: '+27000000025', body: 'Stop texting me please', expect: 'opted_out' },
  { id: 'R06', at: at('18:57'), from: '+27000000027', body: 'BOOK for 4 at 7?', expect: 'link_sent' },
  { id: 'R07', at: at('19:08'), from: '+27000000028', body: 'Do you have gluten free bases?', expect: 'manager_alerted' },
  { id: 'R08', at: at('19:31'), from: '+27000000029', body: 'opt out', expect: 'opted_out' },
  { id: 'R09', at: at('19:47'), from: '+27000000030', body: 'Running 10 min late to collect my order', expect: 'manager_alerted' },
  { id: 'R10', at: at('20:10'), from: '+27000000014', body: 'BOOK', expect: 'blocked_opted_out' },
];

export const CLICKS: readonly ScenarioClick[] = [
  { at: at('08:07'), number: '+27000000001', agent: 'phone', counts: true },
  { at: at('08:31'), number: '+27000000003', agent: 'phone', counts: true },
  { at: at('09:20'), number: '+27000000004', agent: 'phone', counts: true },
  { at: at('11:47'), number: '+27000000006', agent: 'phone', counts: true },
  { at: at('12:09'), number: '+27000000010', agent: 'phone', counts: true },
  { at: at('12:41'), number: '+27000000011', agent: 'phone', counts: true },
  { at: at('12:42'), number: '+27000000011', agent: 'phone', counts: false },
  { at: at('13:25'), number: '+27000000013', agent: 'phone', counts: true },
  { at: at('14:33'), number: '+27000000016', agent: 'phone', counts: true },
  { at: at('17:59'), number: '+27000000022', agent: 'phone', counts: true },
  { at: at('18:05'), number: '+27000000023', agent: 'phone', counts: true },
  { at: at('18:58'), number: '+27000000027', agent: 'phone', counts: true },
  { at: at('19:04:30'), number: '+27000000028', agent: 'preview-bot', counts: false },
  { at: at('19:10'), number: '+27000000028', agent: 'phone', counts: true },
  { at: at('20:20'), number: 'invalid', agent: 'phone', counts: false },
  { at: at('20:55'), number: '+27000000033', agent: 'phone', counts: true },
  { at: at('20:56'), number: '+27000000033', agent: 'phone', counts: false },
];

export const DUPLICATE_CALLBACKS: readonly { at: string; callId: string; secondHandset: boolean }[] = [
  { at: at('12:05:04'), callId: 'C08', secondHandset: false },
  { at: at('17:52:03'), callId: 'C21', secondHandset: false },
  { at: at('18:03:01'), callId: 'C22', secondHandset: true },
  { at: at('19:26:05'), callId: 'C32', secondHandset: false },
];

// Twilio retries the "yes please" webhook. A broken flow would send the booking link twice.
export const DUPLICATE_REPLIES: readonly { at: string; replyId: string }[] = [{ at: at('17:58:02'), replyId: 'R04' }];

export const ANSWERED_CALLS: readonly { at: string; from: string }[] = [
  { at: at('12:15'), from: '+27000000040' },
  { at: at('18:35'), from: '+27000000041' },
  { at: at('19:50'), from: '+27000000042' },
];

// Hand counted from the lists above. The report for 16 October must show exactly these numbers.
export const EXPECTED_REPORT = {
  missedCalls: 40,
  textsSent: 33,
  missedCallTexts: 29,
  bookingLinksResent: 4,
  replies: 10,
  repliesBook: 5,
  repliesOptOut: 3,
  repliesOther: 2,
  bookingsClicked: 13,
  optOuts: 3,
  heldForMorning: 3,
  notTexted: 7,
  repeatCallers: 2,
  optedOutCallers: 2,
  noCallerId: 2,
  foreignNumbers: 1,
  expired: 0,
  failedSends: 1,
  stuckSends: 0,
  duplicateCallbacks: 4,
  managerAlerts: 4,
} as const;

// Release runs every 15 minutes from 08:00 to 20:45, like the schedule in workflow 1.
const releaseTicks = (day: string): string[] => {
  const ticks: string[] = [];
  for (let hour = 8; hour <= 20; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      ticks.push(on(day, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`));
    }
  }
  return ticks;
};

// Everything in time order. At the same instant the report runs before the 08:00 release; the report
// counts do not depend on that order, but a fixed order keeps the output stable.
export const buildTimeline = (): ScenarioEvent[] => {
  const events: ScenarioEvent[] = [
    { kind: 'call', at: PROLOGUE_CALL.at, call: PROLOGUE_CALL },
    { kind: 'reply', at: PROLOGUE_REPLY.at, reply: PROLOGUE_REPLY },
    ...CALLS.map((item): ScenarioEvent => ({ kind: 'call', at: item.at, call: item })),
    ...DUPLICATE_CALLBACKS.map((item): ScenarioEvent => ({ kind: 'duplicate-callback', ...item })),
    ...ANSWERED_CALLS.map((item): ScenarioEvent => ({ kind: 'answered', ...item })),
    ...REPLIES.map((item): ScenarioEvent => ({ kind: 'reply', at: item.at, reply: item })),
    ...DUPLICATE_REPLIES.map((item): ScenarioEvent => ({ kind: 'duplicate-reply', ...item })),
    ...CLICKS.map((item): ScenarioEvent => ({ kind: 'click', at: item.at, click: item })),
    ...releaseTicks(DAY).map((tick): ScenarioEvent => ({ kind: 'release', at: tick })),
    { kind: 'report', at: NEXT_MORNING, date: DAY },
    { kind: 'release', at: NEXT_MORNING },
  ];
  const order: Readonly<Record<ScenarioEvent['kind'], number>> = {
    'call': 0, 'duplicate-callback': 1, 'answered': 2, 'reply': 3, 'duplicate-reply': 4, 'click': 5, 'report': 6, 'release': 7,
  };
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => Date.parse(a.event.at) - Date.parse(b.event.at)
      || order[a.event.kind] - order[b.event.kind]
      || a.index - b.index)
    .map(({ event }) => event);
};
