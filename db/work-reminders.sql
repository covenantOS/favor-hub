-- db/work-reminders.sql (2026-10-10) Reminders for due items, the morning email's settings and its once-a-day lock.
-- Blackbaud's own reminder fields are unused (0 of 33,020 actions in 2026), so nothing here syncs back.

CREATE TABLE IF NOT EXISTS act_reminders (
  id TEXT PRIMARY KEY,                             -- newId('wcr')
  owner TEXT NOT NULL,                             -- lower case email of the person reminded
  kind TEXT NOT NULL,                              -- task | gift | partner | plan_call | message
  ref_id TEXT,                                     -- Blackbaud action id for a task, gift id for a gift
  cid TEXT,                                        -- the partner's system id
  title TEXT NOT NULL,                             -- "Call Naomi back"
  note TEXT,                                       -- one line under the title
  due_at TEXT NOT NULL,                            -- UTC instant the reminder falls due
  state TEXT NOT NULL DEFAULT 'open',              -- open | done
  snoozed_until TEXT,                              -- UTC instant a Later pushed it to; null when never moved
  source TEXT NOT NULL DEFAULT 'manual',           -- manual | plan_calls | message
  created_at TEXT NOT NULL, done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_rem_owner ON act_reminders(owner, state, due_at);

CREATE TABLE IF NOT EXISTS act_mail_prefs (        -- one row per person; no row means the defaults
  owner TEXT PRIMARY KEY,                          -- lower case email
  sections TEXT NOT NULL,                          -- JSON { gifts, due, sent_back, quiet, reminders } each 0 or 1
  send_time TEXT NOT NULL DEFAULT '7:30',          -- 7:30 | 8:00 | off
  skip_empty INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS act_digest_log (        -- the once-a-day lock: a retry or a second cron never sends twice
  owner TEXT NOT NULL, day TEXT NOT NULL,          -- day = Eastern date
  state TEXT NOT NULL,                             -- sending | sent | skipped | failed
  subject TEXT, n INTEGER, detail TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (owner, day)
);
