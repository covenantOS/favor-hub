-- Mail in FavorOS (2026-10-11). Gmail's API has no snooze, so FavorOS keeps its own: a snoozed thread leaves the inbox and comes
-- back (with the unread mark) the first time its owner opens Mail or Today after the time. Thread ids only, never mail content.
CREATE TABLE IF NOT EXISTS hub_mail_snooze (
  email TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  woke_at TEXT,
  PRIMARY KEY (email, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_mail_snooze_due ON hub_mail_snooze(email, woke_at, until);
