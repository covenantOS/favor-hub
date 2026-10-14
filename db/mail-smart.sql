-- Smart Mail (2026-10-12). Additive only, idempotent. Apply with
--   wrangler d1 execute favor-requests --remote --file db/mail-smart.sql
-- hub_mail_class keeps, for each conversation and its newest message id, the decision model's answers (what kind of mail it is,
-- whether it waits on the person) and a one-line summary. Never a message body. hub_mail_cat keeps the person's own category for a
-- sender, set by Move to category. Until the tables exist Mail still works: the rules and plain-words guesses answer instead.
CREATE TABLE IF NOT EXISTS hub_mail_class (
  email TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  last_mid TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  ask INTEGER NOT NULL DEFAULT 0,
  p REAL NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  summary_mid TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  PRIMARY KEY (email, thread_id)
);
CREATE TABLE IF NOT EXISTS hub_mail_cat (
  email TEXT NOT NULL,
  sender TEXT NOT NULL,
  cat TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (email, sender)
);

-- Round 2 (2026-10-12): categories the person describes in words, conversations logged in Blackbaud from Mail, the morning briefing
-- kept for the day, and the person's saved "send later" messages. Still never a message body, except a send-later message the
-- person wrote and has not sent yet (deleted when it goes).
CREATE TABLE IF NOT EXISTS hub_mail_custom (
  email TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, id)
);
CREATE TABLE IF NOT EXISTS hub_mail_logged (
  email TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  partner_id TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  PRIMARY KEY (email, thread_id)
);
CREATE TABLE IF NOT EXISTS hub_mail_brief (
  email TEXT NOT NULL,
  day TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (email, day)
);
CREATE TABLE IF NOT EXISTS hub_mail_later (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  mailbox TEXT NOT NULL DEFAULT '',
  send_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  remind_days INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'waiting',
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_mail_later_due ON hub_mail_later(state, send_at);
CREATE TABLE IF NOT EXISTS hub_mail_waits (
  email TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  until TEXT NOT NULL DEFAULT '',
  last_mid TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  woke_at TEXT,
  PRIMARY KEY (email, thread_id, kind)
);
CREATE TABLE IF NOT EXISTS hub_mail_tpl (
  email TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (email, id)
);

-- Briefing close (2026-10-14): the date of the newest important message (people, partners, staff) when the person closed the
-- "This morning" card. The card stays closed until something newer and important arrives. Per person, on every device.
CREATE TABLE IF NOT EXISTS hub_mail_brief_off (
  email TEXT PRIMARY KEY,
  key TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
