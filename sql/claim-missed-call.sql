-- Claims a missed call exactly once. call_key is the idempotency key, so a retried or duplicate
-- Twilio callback only bumps callback_count and never produces a second text.
-- $1 call_key, $2 call_sid, $3 caller_e164 (or null), $4 call_status, $5 called_at, $6 now
WITH claim AS (
  INSERT INTO hs_missed_calls (call_key, call_sid, caller_e164, call_status, called_at, received_at, outcome, link_token)
  VALUES ($1::text, $2::text, NULLIF($3::text, ''), $4::text, $5::timestamptz, $6::timestamptz, 'claimed',
          substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  ON CONFLICT (call_key) DO UPDATE SET callback_count = hs_missed_calls.callback_count + 1
  RETURNING call_key, caller_e164, link_token, callback_count
)
SELECT
  c.call_key,
  c.caller_e164,
  c.link_token,
  c.callback_count,
  EXISTS (SELECT 1 FROM hs_opt_outs o WHERE o.phone_e164 = c.caller_e164) AS opted_out,
  (SELECT max(m.sent_at) FROM hs_missed_calls m
    WHERE m.caller_e164 = c.caller_e164 AND m.call_key <> c.call_key AND m.outcome = 'sent') AS last_sent_at,
  EXISTS (SELECT 1 FROM hs_missed_calls m
    WHERE m.caller_e164 = c.caller_e164 AND m.call_key <> c.call_key AND m.outcome = 'queued') AS has_queued
FROM claim c
