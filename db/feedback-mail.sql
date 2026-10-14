-- Apply with: wrangler d1 execute favor-requests --remote --file db/feedback-mail.sql (after db/notify.sql)
-- Feedback replies: the reply text that was emailed (or held), so each reply is emailed once and a new reply is emailed again.
-- reply_mailed_at is the send time, or 'held' for replies written before this shipped (no catch-up mail without Will's yes).
ALTER TABLE brain_feedback ADD COLUMN reply_mailed TEXT;
ALTER TABLE brain_feedback ADD COLUMN reply_mailed_at TEXT;

-- Notes already fixed when this shipped are held: no catch-up email until Will says yes (then set reply_mailed_at = NULL on them).
UPDATE brain_feedback SET reply_mailed = COALESCE(trim(reply), ''), reply_mailed_at = 'held' WHERE status = 'fixed' AND reply_mailed_at IS NULL;
