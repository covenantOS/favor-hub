-- Move to Chat (2026-10-14): which email conversations a person moved to FavorOS Chat, or hid the suggestion for.
-- The same statement runs the first time Mail needs it (functions/_lib/mail/tochat.ts), so applying this file is optional.
CREATE TABLE IF NOT EXISTS hub_mail_chat (
  owner TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  state TEXT NOT NULL,                       -- moved | dismissed
  channel_id TEXT NOT NULL DEFAULT '',
  message_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner, thread_id)
);
