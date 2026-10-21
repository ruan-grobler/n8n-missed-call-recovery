-- Records what happened to a claimed call. Used by the queued, not texted, sent and failed steps.
-- $1 call_key, $2 outcome, $3 send_after, $4 sent_at, $5 sms_sid, $6 last_error (null keeps the old value)
UPDATE hs_missed_calls SET
  outcome = $2::text,
  send_after = COALESCE($3::timestamptz, send_after),
  sent_at = COALESCE($4::timestamptz, sent_at),
  sms_sid = COALESCE($5::text, sms_sid),
  last_error = COALESCE($6::text, last_error)
WHERE call_key = $1::text
RETURNING call_key, outcome, caller_e164, called_at, last_error
