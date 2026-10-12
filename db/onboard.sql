-- Onboarding and offboarding in FavorOS, lane ONBOARD (2026-10-11). Additive only, never applied to production by the lane.
--   onb_runs       one onboarding or offboarding run for one person
--   onb_steps      the checklist of a run: owner, due date, status, and the task in Projects it became
--   onb_docs       completion marks for the HR file (a document was received). No document, form answer or ID number is stored here.
--   onb_owners     who owns each duty (directory, WhatsApp, shared drive, HR file, training, technical access)
--   onb_template   the checklist template HR edits; empty means the built-in default list
--   onb_reminders  reminders already sent, so a step is never reminded twice a day
--   onb_log        what happened on a run, for the record
-- The HR forms stay where HR keeps them (the GoHighLevel paperwork site and the US Talent folder). Staff names and addresses are
-- not seeded from this file (the repository is public). Owners are set on the Onboarding page.

CREATE TABLE IF NOT EXISTS onb_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'onboard',          -- onboard | offboard
  email TEXT NOT NULL,                            -- the person's Favor address
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  supervisor_email TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,                             -- start date (onboard) or last day (offboard), YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'active',          -- active | done | cancelled
  hq INTEGER NOT NULL DEFAULT 1,                  -- 1 works at headquarters (door code, tour, devotions); 0 remote
  stays INTEGER NOT NULL DEFAULT 0,               -- offboarding only: 1 stays on as a volunteer, accounts stay open
  welcome TEXT NOT NULL DEFAULT '',               -- a note from the supervisor, shown on the first-day page
  hub_done INTEGER NOT NULL DEFAULT 0,            -- 1 after FavorOS access was added (onboard) or closed (offboard)
  hub_done_at TEXT,
  hub_done_by TEXT,
  project_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_onb_runs_email ON onb_runs(email, kind, status);
CREATE INDEX IF NOT EXISTS idx_onb_runs_status ON onb_runs(status, date);

CREATE TABLE IF NOT EXISTS onb_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  key TEXT NOT NULL,                              -- the template key, or custom_<n> for a step added to this run
  grp TEXT NOT NULL DEFAULT 'before',             -- before | day1 | week1 | month1 (offboard: before | last | after)
  sort REAL NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'task',              -- task | form | learn | auto
  duty TEXT NOT NULL DEFAULT '',                  -- directory | whatsapp | hr | training | tech | supervisor | hire | starter
  owner_email TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',            -- open | done | skipped
  done_by TEXT,
  done_at TEXT,
  link_url TEXT NOT NULL DEFAULT '',
  link_label TEXT NOT NULL DEFAULT '',
  task_id TEXT,                                   -- hub_tasks.id when Projects is on
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_onb_steps_run ON onb_steps(run_id, sort);
CREATE INDEX IF NOT EXISTS idx_onb_steps_owner ON onb_steps(owner_email, status, due_date);

CREATE TABLE IF NOT EXISTS onb_docs (
  run_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort REAL NOT NULL DEFAULT 0,
  got INTEGER NOT NULL DEFAULT 0,
  got_by TEXT,
  got_at TEXT,
  PRIMARY KEY (run_id, key)
);

CREATE TABLE IF NOT EXISTS onb_owners (
  duty TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS onb_template (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                             -- onboard | offboard
  key TEXT NOT NULL,
  grp TEXT NOT NULL,
  sort REAL NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  step_kind TEXT NOT NULL DEFAULT 'task',
  duty TEXT NOT NULL DEFAULT '',
  offset_days INTEGER NOT NULL DEFAULT 0,         -- days from the start date or the last day; negative is before
  link_url TEXT NOT NULL DEFAULT '',
  link_label TEXT NOT NULL DEFAULT '',
  hq_only INTEGER NOT NULL DEFAULT 0,
  leaving_only INTEGER NOT NULL DEFAULT 0,        -- offboarding: skipped when the person stays on as a volunteer
  docs TEXT NOT NULL DEFAULT '[]',                -- HR file items under this step, a JSON list of labels
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, key)
);

CREATE TABLE IF NOT EXISTS onb_reminders (
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL,                             -- start | due | late
  day TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (step_id, kind, day)
);

CREATE TABLE IF NOT EXISTS onb_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_onb_log_run ON onb_log(run_id, id);
