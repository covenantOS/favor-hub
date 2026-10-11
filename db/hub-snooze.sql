-- db/hub-snooze.sql (2026-10-10) Snooze on Today. A Needs you card a person snoozes stays hidden until until_date (ET).
-- Idempotent: safe to run more than once on the favor-requests D1.
CREATE TABLE IF NOT EXISTS hub_snoozes (
  user_email TEXT NOT NULL,
  item_key TEXT NOT NULL,
  until_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_email, item_key)
);
