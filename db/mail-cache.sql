-- Mail speed (2026-10-12). Additive only, idempotent. Apply with
--   wrangler d1 execute favor-requests --remote --file db/mail-cache.sql
-- hub_mail_rows keeps each conversation's list row (sender, subject, a one-line preview, labels, date) under its Gmail history id, so the
-- list renders from D1 and Gmail is read only for conversations that changed. hub_mail_people keeps what the Blackbaud copy said about a
-- sender's address, and hub_mail_giving a partner's giving totals, for a few hours. Headers and previews only, never a message body.
CREATE TABLE IF NOT EXISTS hub_mail_rows (
  mailbox TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  hid TEXT NOT NULL DEFAULT '',
  row_json TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (mailbox, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_mail_rows_at ON hub_mail_rows(at);
CREATE TABLE IF NOT EXISTS hub_mail_people (
  email TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_mail_giving (
  partner_id TEXT PRIMARY KEY,
  max_gift REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  last_date TEXT NOT NULL DEFAULT '',
  last_amount REAL NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
