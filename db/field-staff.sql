-- db/field-staff.sql (2026-10-12) Phone app and field staff. Every statement is additive.
--   hub_users.pending   1 = signed in from an allowed partner domain and waiting for an admin. A pending row is also blocked = 1,
--                       so every list and check that already skips blocked people skips them. Approve sets both to 0.
--   push_subs           one row per browser or phone that turned on notifications (web push)
--   phone_sends         an offline queue resends safely: a repeat client id gets the stored answer instead of a second message

ALTER TABLE hub_users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_ok TEXT,
  fails INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subs_email ON push_subs(email);

CREATE TABLE IF NOT EXISTS phone_sends (
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, client_id)
);
