-- Counts a tap on the tracked booking link. clicked_at keeps the first tap. $1 token, $2 now
WITH hit AS (
  UPDATE hs_missed_calls SET
    clicked_at = COALESCE(clicked_at, $2::timestamptz),
    click_count = click_count + 1
  WHERE link_token = $1::text
  RETURNING call_key
)
SELECT count(*)::int AS matched FROM hit
