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

-- Mail to teammates (2026-10-12): conversations a person handed to a teammate. The subject and the person's note only; the teammate got a Chat notice.
CREATE TABLE IF NOT EXISTS hub_mail_assign (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  assignee TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_mail_assign_owner ON hub_mail_assign(owner, state);

-- Where each mailbox's saved inbox stands in Gmail's history (2026-10-12).
CREATE TABLE IF NOT EXISTS hub_mail_sync (
  mailbox TEXT PRIMARY KEY,
  history_id TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL,
  next_token TEXT NOT NULL DEFAULT ''
);
-- Mail held before it goes (2026-10-12): the 15 second undo window, kept on the server so closing the tab loses nothing.
CREATE TABLE IF NOT EXISTS hub_mail_held (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  mailbox TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  release_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'held',
  thread_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_mail_held_due ON hub_mail_held(state, release_at);
