-- Missed call recovery kit, free edition. Safe to run more than once.
-- Workflow 1 runs this from its "Run once: create tables" step, or paste it into your Postgres SQL editor.
-- Message text from customers is never stored. Phone numbers are stored in E.164 so opt outs match reliably.
CREATE TABLE IF NOT EXISTS hs_missed_calls (
  call_key        text PRIMARY KEY,
  call_sid        text NOT NULL,
  caller_e164     text,
  call_status     text NOT NULL,
  called_at       timestamptz NOT NULL,
  received_at     timestamptz NOT NULL,
  outcome         text NOT NULL DEFAULT 'claimed' CHECK (outcome IN (
                    'claimed', 'sending', 'sent', 'queued', 'failed', 'opted_out',
                    'repeat_caller', 'no_caller_id', 'foreign_number', 'expired')),
  callback_count  integer NOT NULL DEFAULT 1,
  send_after      timestamptz,
  sent_at         timestamptz,
  sms_sid         text,
  last_error      text,
  link_token      text NOT NULL UNIQUE,
  clicked_at      timestamptz,
  click_count     integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS hs_missed_calls_caller_idx ON hs_missed_calls (caller_e164, called_at DESC);
CREATE INDEX IF NOT EXISTS hs_missed_calls_queue_idx ON hs_missed_calls (send_after) WHERE outcome = 'queued';

CREATE TABLE IF NOT EXISTS hs_opt_outs (
  phone_e164    text PRIMARY KEY,
  opted_out_at  timestamptz NOT NULL,
  source        text NOT NULL DEFAULT 'sms_reply'
);

CREATE TABLE IF NOT EXISTS hs_sms_replies (
  message_sid  text PRIMARY KEY,
  from_e164    text,
  intent       text NOT NULL CHECK (intent IN ('opt_out', 'book', 'other')),
  action       text NOT NULL DEFAULT 'pending' CHECK (action IN (
                 'pending', 'opted_out', 'link_sent', 'link_failed', 'blocked_opted_out', 'manager_alerted')),
  detail       text,
  received_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS hs_sms_replies_received_idx ON hs_sms_replies (received_at);
