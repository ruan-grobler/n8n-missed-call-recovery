-- Loads one day of activity for the report. No phone numbers leave the database here, only outcomes and times.
-- $1 window start, $2 window end
SELECT
  (SELECT coalesce(json_agg(json_build_object(
      'outcome', m.outcome,
      'called_at', m.called_at,
      'sent_at', m.sent_at,
      'send_after', m.send_after,
      'clicked_at', m.clicked_at,
      'callback_count', m.callback_count)), '[]'::json)
   FROM hs_missed_calls m
   WHERE (m.called_at >= $1::timestamptz AND m.called_at < $2::timestamptz)
      OR (m.sent_at >= $1::timestamptz AND m.sent_at < $2::timestamptz)
      OR (m.clicked_at >= $1::timestamptz AND m.clicked_at < $2::timestamptz)) AS calls,
  (SELECT coalesce(json_agg(json_build_object(
      'intent', r.intent,
      'action', r.action,
      'received_at', r.received_at)), '[]'::json)
   FROM hs_sms_replies r
   WHERE r.received_at >= $1::timestamptz AND r.received_at < $2::timestamptz) AS replies,
  (SELECT count(*)::int FROM hs_opt_outs o
   WHERE o.opted_out_at >= $1::timestamptz AND o.opted_out_at < $2::timestamptz) AS opt_outs
