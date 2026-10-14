-- One row per scheduled job: the favor-work-drain Worker writes the outcome of every run here (functions/_lib/admin/cronruns.ts lists the
-- jobs), so a job that stops or fails shows on Admin > Overview the same day instead of going quiet.
CREATE TABLE IF NOT EXISTS hub_cron_runs (
  job TEXT PRIMARY KEY,
  last_run TEXT NOT NULL,
  last_ok TEXT,
  last_error TEXT,
  error_at TEXT,
  detail TEXT NOT NULL DEFAULT '',
  fails INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0
);
