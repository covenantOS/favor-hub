-- Chat email (2026-10-13). Additive only: four new tables. Apply with
--   wrangler d1 execute favor-requests --remote --file db/chat-email.sql
-- Two emails: "started a conversation with you" (the first message in a conversation that includes you) and one unread
-- follow-up per conversation, ten minutes after a message for you stays unread. The 5-minute work drain cron runs both.
-- Only messages created after the first run are considered (chat_email_state key since), so old messages never send.

-- Each person's switch. No row means on. The token is the key in the footer link that turns it off.
CREATE TABLE IF NOT EXISTS chat_email_prefs (
  email TEXT PRIMARY KEY,
  on_chat INTEGER NOT NULL DEFAULT 1,
  token TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per email: who, which conversation, which messages, when.
CREATE TABLE IF NOT EXISTS chat_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL,                      -- start | unread
  message_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array
  sent_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'sending'    -- sending | sent | failed
);
CREATE INDEX IF NOT EXISTS idx_chat_email_log_pair ON chat_email_log(email, channel_id, sent_at);

-- One row per message a person was emailed about. The primary key is the once-only lock, taken before the send.
CREATE TABLE IF NOT EXISTS chat_email_sent (
  email TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  log_id INTEGER NOT NULL,
  PRIMARY KEY (email, message_id)
);

CREATE TABLE IF NOT EXISTS chat_email_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- One row per person already welcomed: the once-only lock for the welcome email, taken before it is sent.
CREATE TABLE IF NOT EXISTS chat_email_welcome (
  email TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  message_id INTEGER
);

-- Rachel Cox and Michael Hinton got the welcome by hand from Will at 7:53 AM Eastern on 2026-10-13 (the group dm_ed57bbc15ddd,
-- message 881). They are welcomed already, and message 881 counts as emailed to both.
INSERT OR IGNORE INTO chat_email_welcome (email, sent_at, message_id) VALUES
  ('rachel@favorintl.org', '2026-10-13T11:53:00.000Z', 881),
  ('michael@favorintl.org', '2026-10-13T11:53:00.000Z', 881);
INSERT INTO chat_email_log (email, channel_id, kind, message_ids, sent_at, state)
  SELECT 'rachel@favorintl.org', 'dm_ed57bbc15ddd', 'welcome', '[881]', '2026-10-13T11:53:00.000Z', 'sent'
   WHERE NOT EXISTS (SELECT 1 FROM chat_email_sent WHERE email = 'rachel@favorintl.org' AND message_id = 881);
INSERT INTO chat_email_log (email, channel_id, kind, message_ids, sent_at, state)
  SELECT 'michael@favorintl.org', 'dm_ed57bbc15ddd', 'welcome', '[881]', '2026-10-13T11:53:00.000Z', 'sent'
   WHERE NOT EXISTS (SELECT 1 FROM chat_email_sent WHERE email = 'michael@favorintl.org' AND message_id = 881);
INSERT OR IGNORE INTO chat_email_sent (email, message_id, log_id)
  SELECT email, 881, MAX(id) FROM chat_email_log WHERE email IN ('rachel@favorintl.org', 'michael@favorintl.org') AND kind = 'welcome' GROUP BY email;
