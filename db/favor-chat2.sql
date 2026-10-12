-- Favor Chat, second round (2026-10-11): pinned messages and bookmarks. Additive only: two new tables and one index.
-- Apply with
--   wrangler d1 execute favor-requests --remote --file db/favor-chat2.sql
-- Until it is applied Chat works as before: the page hides Pin and the bookmarks bar, and the pin and bookmark routes
-- answer 503 not_ready. Everything else in this round (threads, mark unread, mentions and reactions) reads the tables
-- Chat already has.

-- One row per pinned message. Any member of the conversation may pin or unpin.
CREATE TABLE IF NOT EXISTS chat_pins (
  message_id INTEGER PRIMARY KEY,
  channel_id TEXT NOT NULL,
  pinned_by TEXT NOT NULL,
  pinned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_pins_channel ON chat_pins(channel_id, pinned_at);

-- Links kept at the top of a conversation: a web address, or a page on the hub (/reports/ and the like).
CREATE TABLE IF NOT EXISTS chat_bookmarks (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_bookmarks_channel ON chat_bookmarks(channel_id, added_at);

-- The Threads view finds the threads a person replied in by author. Without this index it still works, by scanning.
CREATE INDEX IF NOT EXISTS idx_chat_messages_author ON chat_messages(email, thread_id);
