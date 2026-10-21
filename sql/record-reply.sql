-- Stores an inbound SMS reply once (MessageSid is the idempotency key) and, for STOP style replies,
-- adds the number to the opt out list in the same statement. The message text itself is never stored.
-- $1 message_sid, $2 from_e164, $3 intent, $4 received_at
WITH reply AS (
  INSERT INTO hs_sms_replies (message_sid, from_e164, intent, received_at)
  VALUES ($1::text, $2::text, $3::text, $4::timestamptz)
  ON CONFLICT (message_sid) DO NOTHING
  RETURNING message_sid
), opt_out AS (
  INSERT INTO hs_opt_outs (phone_e164, opted_out_at, source)
  SELECT $2::text, $4::timestamptz, 'sms_reply'
  WHERE $3::text = 'opt_out' AND EXISTS (SELECT 1 FROM reply)
  ON CONFLICT (phone_e164) DO NOTHING
  RETURNING phone_e164
)
SELECT
  EXISTS (SELECT 1 FROM reply) AS is_new,
  EXISTS (SELECT 1 FROM hs_opt_outs o WHERE o.phone_e164 = $2::text) AS opted_out_before,
  EXISTS (SELECT 1 FROM opt_out) AS opted_out_now,
  (SELECT m.link_token FROM hs_missed_calls m
    WHERE m.caller_e164 = $2::text AND m.outcome = 'sent'
    ORDER BY m.called_at DESC LIMIT 1) AS link_token
