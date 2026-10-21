-- Releases texts that waited for quiet hours to end. The opt out list is checked again here, at send time,
-- so someone who opted out overnight is never texted. Texts older than the stale cut off are dropped.
-- $1 now, $2 stale_before
WITH due AS (
  SELECT call_key FROM hs_missed_calls
  WHERE outcome = 'queued' AND send_after <= $1::text::timestamptz
  ORDER BY send_after, called_at
  LIMIT 200
  FOR UPDATE SKIP LOCKED
)
UPDATE hs_missed_calls m SET outcome = CASE
    WHEN EXISTS (SELECT 1 FROM hs_opt_outs o WHERE o.phone_e164 = m.caller_e164) THEN 'opted_out'
    WHEN m.called_at < $2::timestamptz THEN 'expired'
    ELSE 'sending'
  END
FROM due
WHERE m.call_key = due.call_key
RETURNING m.call_key, m.caller_e164, m.link_token, m.outcome, $1::text AS now_iso
