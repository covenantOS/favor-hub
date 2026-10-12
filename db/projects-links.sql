-- Projects: the links into Chat, Google Calendar and email (lane LINKS, 2026-10-11). Additive only: new tables, nothing changed.
-- Apply with: wrangler d1 execute favor-requests --remote --file db/projects-links.sql  (after db/projects.sql)
-- Every notice, email and calendar write below passes the request board's gate (hub_settings requests.notify and
-- requests.notify.only), so nothing reaches real staff while that switch is off.

-- A Chat message that belongs to a task, the way request_chat_links ties messages to a request.
--   card   the task card posted in a channel or direct message
--   reply  a reply typed under a card in Chat; it is also a comment on the task (comment_id)
--   copy   a comment typed in the hub, copied under the latest card in each conversation its author is part of
--   source the message a task was made from ("Make a task from this message")
CREATE TABLE IF NOT EXISTS hub_task_chat_links (
  message_id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  root_id INTEGER,
  comment_id TEXT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_task_chat_links_task ON hub_task_chat_links(task_id, kind);
CREATE INDEX IF NOT EXISTS idx_hub_task_chat_links_comment ON hub_task_chat_links(comment_id);

-- How each person wants project email, and whether due dates go on their Google Calendar.
--   mail_mode  now (one email per notice), daily (one summary each weekday morning) or off. No row means now.
--   calendar   1 puts the due dates of tasks they own on their primary calendar (needs their Google connection with the
--              calendar.events scope); 0 keeps their calendar alone. No row means 1.
CREATE TABLE IF NOT EXISTS hub_project_prefs (
  email TEXT PRIMARY KEY,
  mail_mode TEXT NOT NULL DEFAULT 'now',
  calendar INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- The Google Calendar event that carries one task's due date on one person's calendar.
CREATE TABLE IF NOT EXISTS hub_task_gcal (
  task_id TEXT NOT NULL,
  email TEXT NOT NULL,
  event_id TEXT NOT NULL,
  stamp TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL,
  PRIMARY KEY (task_id, email)
);

-- One row per notice that was emailed or put in a summary, taken before the send so no notice is emailed twice.
CREATE TABLE IF NOT EXISTS hub_task_mail_log (
  notice_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  mode TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'sending',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_task_mail_log_email ON hub_task_mail_log(email, at);
