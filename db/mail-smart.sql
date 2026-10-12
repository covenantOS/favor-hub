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
