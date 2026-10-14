-- db/gift-notices.sql (2026-10-14) Gift notices in Chat: one row per gift posted to #leadership-gifts, taken before the post.
CREATE TABLE IF NOT EXISTS hub_gift_notices (
  gift_id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  amount REAL NOT NULL,
  channel_id TEXT NOT NULL,
  message_id INTEGER,
  posted_at TEXT NOT NULL
);
