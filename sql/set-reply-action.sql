-- Records what the kit did with a reply. $1 message_sid, $2 action, $3 detail (or null)
UPDATE hs_sms_replies SET action = $2::text, detail = COALESCE($3::text, detail)
WHERE message_sid = $1::text
RETURNING message_sid, from_e164, action, detail
