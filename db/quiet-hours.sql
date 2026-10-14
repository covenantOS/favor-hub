-- db/quiet-hours.sql (2026-10-14) Quiet hours for Chat and notices. Additive only: two new tables. Apply with
--   wrangler d1 execute favor-requests --remote --file db/quiet-hours.sql
-- No row in hub_quiet means the default: on, 8 PM to 7 AM in the person's time zone (hub_sched_prefs.tz, else Eastern), weekends off.

CREATE TABLE IF NOT EXISTS hub_quiet (
  email TEXT PRIMARY KEY,
  on_quiet INTEGER NOT NULL DEFAULT 1,
  start_min INTEGER NOT NULL DEFAULT 1200,  -- minutes after local midnight
  end_min INTEGER NOT NULL DEFAULT 420,
  weekends INTEGER NOT NULL DEFAULT 0,      -- 1: Saturday and Sunday are quiet all day
  tz TEXT NOT NULL DEFAULT '',              -- empty: the scheduling time zone, else Eastern
  updated_at TEXT NOT NULL
);

-- A push or notice email held during quiet hours. sent_at is set when the morning summary goes out.
CREATE TABLE IF NOT EXISTS hub_quiet_held (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- push | chat | request | project
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  message_id INTEGER,
  held_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_quiet_held_open ON hub_quiet_held(email, sent_at);
