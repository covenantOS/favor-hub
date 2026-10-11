-- Favor Chat: private Brain answers (2026-10-11). Additive: one nullable column.
-- NULL means every member of the channel can read the message. An email means only that person can.
-- Run once (SQLite has no ADD COLUMN IF NOT EXISTS):
--   wrangler d1 execute favor-requests --remote --file db/favor-chat-private.sql
ALTER TABLE chat_messages ADD COLUMN visible_to TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_messages_visible ON chat_messages(visible_to) WHERE visible_to IS NOT NULL;
