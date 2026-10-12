-- Projects: the Friday status update switch. One row per project, written only when a project owner turns the update on or off.
-- Additive only. A project with no row has the update off.
CREATE TABLE IF NOT EXISTS hub_project_status (
  project_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  enabled_by TEXT NOT NULL DEFAULT '',
  enabled_at TEXT,
  last_week TEXT,            -- Monday (YYYY-MM-DD) of the week the last update covered
  last_posted_at TEXT,
  last_message_id INTEGER,
  last_error TEXT NOT NULL DEFAULT ''
);
