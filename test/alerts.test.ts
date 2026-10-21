import { describe, expect, it } from 'vitest';
import { describeTwilioError, failedSmsAlert, linkFailedAlert, replyAlert } from '../src/logic/alerts.ts';

// Shape copied from a real n8n 2.44.5 execution: the HTTP Request node's error output after the mock
// Twilio API answered 400. The stack trace is shortened.
const N8N_ERROR_ITEM = {
  call_key: 'CA00000000000000000000000000000003',
  sms_to: '+27000000035',
  error: {
    message: '400 - "{\\"code\\":21614,\\"message\\":\\"\'To\' number is not a valid mobile number\\",\\"more_info\\":\\"https://www.twilio.com/docs/errors/21614\\",\\"status\\":400}"',
    name: 'AxiosError',
    stack: 'AxiosError: Request failed with status code 400\n    at settle (axios.cjs:2530:12)',
    status: 400,
  },
};

describe('describeTwilioError', () => {
  it('reads the error n8n stores for a refused SMS', () => {
    expect(describeTwilioError({ error: N8N_ERROR_ITEM.error })).toBe("'To' number is not a valid mobile number (Twilio error 21614)");
  });

  it('reads a plain Twilio error body', () => {
    expect(describeTwilioError({ code: 21211, message: "Invalid 'To' Phone Number", status: 400 })).toBe("Invalid 'To' Phone Number (Twilio error 21211)");
    expect(describeTwilioError('{"message":"Unable to create record","code":21612}')).toBe('Unable to create record (Twilio error 21612)');
  });

  it('falls back to whatever message or text there is', () => {
    expect(describeTwilioError({ code: 30003 })).toBe('Twilio error 30003');
    expect(describeTwilioError({ message: 'getaddrinfo ENOTFOUND api.twilio.com' })).toBe('getaddrinfo ENOTFOUND api.twilio.com');
    expect(describeTwilioError('socket hang up')).toBe('socket hang up');
    expect(describeTwilioError('')).toBe('unknown error');
  });
});

describe('alert texts', () => {
  it('tells the manager who to call back after a failed text', () => {
    const alert = failedSmsAlert('Harbour Slice', '+27000000035', '2026-10-16T17:12:00.000Z', 'Africa/Johannesburg', 'boom');
    expect(alert.alert_text).toBe('Harbour Slice: we could not text a missed caller (+27 00 000 0035, called at 19:12). boom. Please call them back.');
  });

  it('passes on a reply, or explains a blocked one', () => {
    expect(replyAlert('Harbour Slice', '+27000000028', '2026-10-16T17:08:00.000Z', 'Africa/Johannesburg', 'Gluten free?', false).alert_text)
      .toBe('Harbour Slice: +27 00 000 0028 replied at 19:08: "Gluten free?". Reply to them from the shop phone.');
    expect(replyAlert('Harbour Slice', '+27000000014', '2026-10-16T18:10:00.000Z', 'Africa/Johannesburg', 'BOOK', true).alert_subject)
      .toBe('Harbour Slice: opted out customer asked for the booking link');
  });

  it('asks the manager to send the link by hand when the resend failed', () => {
    expect(linkFailedAlert('Harbour Slice', '+27000000011', 'Twilio error 30003').alert_text)
      .toBe('Harbour Slice: +27 00 000 0011 asked for the booking link, but the SMS failed. Twilio error 30003. Please send it by hand.');
  });
});
