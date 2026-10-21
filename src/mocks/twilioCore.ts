// Mock of the one Twilio endpoint the kit uses: POST /2010-04-01/Accounts/{sid}/Messages.json.
// Used in-process by the demo and over HTTP by the docker e2e run. Responses copy Twilio's JSON shape.

export interface MockSms {
  sid: string;
  accountSid: string;
  to: string;
  from: string;
  body: string;
  // Set by the e2e harness or the demo so assertions can talk about simulated time.
  simulatedAt: string | null;
}

export interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface TwilioCore {
  sendMessage: (accountSid: string, form: Readonly<Record<string, string>>, authorized: boolean) => MockResponse;
  messages: () => MockSms[];
  setClock: (iso: string | null) => void;
  reset: () => void;
}

const twilioError = (status: number, code: number, message: string): MockResponse => ({
  status,
  body: { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status },
});

// failTo: numbers that behave like landlines. Twilio answers those with error 21614.
export const createTwilioCore = (failTo: readonly string[] = []): TwilioCore => {
  let sent: MockSms[] = [];
  let clock: string | null = null;
  return {
    sendMessage: (accountSid, form, authorized): MockResponse => {
      if (!authorized) {
        return twilioError(401, 20003, 'Authenticate');
      }
      const to = form.To ?? '';
      const from = form.From ?? '';
      const body = form.Body ?? '';
      if (!/^\+[1-9]\d{6,14}$/.test(to)) {
        return twilioError(400, 21211, `Invalid 'To' Phone Number: ${to}`);
      }
      if (from === '' || body === '') {
        return twilioError(400, 21602, 'Message body is required.');
      }
      if (failTo.includes(to)) {
        return twilioError(400, 21614, "'To' number is not a valid mobile number");
      }
      const sid = `SM${String(sent.length + 1).padStart(32, '0')}`;
      sent.push({ sid, accountSid, to, from, body, simulatedAt: clock });
      return {
        status: 201,
        body: {
          sid,
          account_sid: accountSid,
          to,
          from,
          body,
          status: 'queued',
          num_segments: '1',
          api_version: '2010-04-01',
          uri: `/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`,
        },
      };
    },
    messages: () => [...sent],
    setClock: (iso): void => {
      clock = iso;
    },
    reset: (): void => {
      sent = [];
      clock = null;
    },
  };
};
