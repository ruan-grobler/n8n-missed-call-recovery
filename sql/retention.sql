-- POPIA retention: deletes call and reply rows older than the cut off. The opt out list is kept on purpose,
-- because forgetting an opt out would mean texting that person again. $1 retention_before
WITH calls AS (
  DELETE FROM hs_missed_calls WHERE called_at < $1::timestamptz RETURNING 1
), replies AS (
  DELETE FROM hs_sms_replies WHERE received_at < $1::timestamptz RETURNING 1
)
SELECT (SELECT count(*)::int FROM calls) AS calls_deleted, (SELECT count(*)::int FROM replies) AS replies_deleted
