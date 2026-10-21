// Mock Slack (chat.postMessage) and an email inbox. Nothing leaves the machine.

export interface SlackPost {
  channel: string;
  text: string;
}

export interface CapturedEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

export interface SinksCore {
  postSlack: (authorized: boolean, body: Readonly<Record<string, unknown>>) => { status: number; body: Record<string, unknown> };
  addEmail: (email: CapturedEmail) => void;
  slack: () => SlackPost[];
  emails: () => CapturedEmail[];
  reset: () => void;
}

export const createSinksCore = (): SinksCore => {
  let posts: SlackPost[] = [];
  let inbox: CapturedEmail[] = [];
  return {
    // Like the real API: HTTP 200 with ok false for auth and argument problems.
    postSlack: (authorized, body): { status: number; body: Record<string, unknown> } => {
      if (!authorized) {
        return { status: 200, body: { ok: false, error: 'not_authed' } };
      }
      const channel = typeof body.channel === 'string' ? body.channel : '';
      const text = typeof body.text === 'string' ? body.text : '';
      if (channel === '' || text === '') {
        return { status: 200, body: { ok: false, error: channel === '' ? 'channel_not_found' : 'no_text' } };
      }
      posts.push({ channel, text });
      return { status: 200, body: { ok: true, channel, ts: `${1_700_000_000 + posts.length}.000100` } };
    },
    addEmail: (email): void => {
      inbox.push(email);
    },
    slack: () => [...posts],
    emails: () => [...inbox],
    reset: (): void => {
      posts = [];
      inbox = [];
    },
  };
};
