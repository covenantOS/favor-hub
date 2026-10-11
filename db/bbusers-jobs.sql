-- db/bbusers-jobs.sql (2026-10-11) Blackbaud user requests: add, change access, deactivate. SKY has no user endpoint, so an admin's request is
-- saved here and the desktop automation (webview/nxt_user_jobs.py) picks it up, runs it in the Blackbaud web view and reports back.
-- Additive. Safe to run more than once.
CREATE TABLE IF NOT EXISTS bb_user_jobs (
  id TEXT PRIMARY KEY,                       -- newId('bbj')
  kind TEXT NOT NULL,                        -- add | access | deactivate
  target_email TEXT NOT NULL,                -- the user's email, lower case
  target_name TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',        -- JSON: the access to give (see functions/_lib/work/bbuser-jobs.ts)
  state TEXT NOT NULL DEFAULT 'queued',      -- queued | running | checked | done | failed | cancelled
  requested_by TEXT NOT NULL,                -- name
  requested_email TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT ''            -- one plain line: what the desktop did or why it stopped
);
CREATE INDEX IF NOT EXISTS idx_bb_user_jobs_state ON bb_user_jobs(state, requested_at);
CREATE INDEX IF NOT EXISTS idx_bb_user_jobs_target ON bb_user_jobs(target_email, state);
