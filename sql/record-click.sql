-- Counts a tap on the tracked booking link. clicked_at keeps the first tap. $1 token, $2 now
-- first_tap is true only for the first tap on a real link, so time saved counts each booking once.
WITH hit AS (
  UPDATE hs_missed_calls SET
    clicked_at = COALESCE(clicked_at, $2::timestamptz),
    click_count = click_count + 1
  WHERE link_token = $1::text
  RETURNING call_key, click_count
)
SELECT count(*)::int AS matched, coalesce(bool_or(click_count = 1), false) AS first_tap FROM hit
