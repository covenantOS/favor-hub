-- Asana import (lane IMPORT). Additive only: new tables, nothing in db/projects.sql changes.
-- Applied by hand to the hub D1 (favor-requests) after db/projects.sql.
--
--   hub_asana_map     Asana gid -> hub id, one row per imported thing (project, section, task, story, attachment).
--                     `hash` is a fingerprint of what Asana held at the last import, `synced_at` is when the hub row was last
--                     written by the importer. A second run updates by gid and never inserts a second copy.
--   hub_asana_deps    dependency edges seen in Asana, by gid. The final step of a run turns them into hub_task_deps once both
--                     ends exist (an edge that closes a cycle, or points outside the import, is reported and skipped).
--   hub_task_fields   Asana tags and custom fields that have no column of their own on hub_tasks.
--   hub_asana_runs    one row per dry run or import: what was asked, where it stands, the report.
--   hub_asana_log     the run's log lines, shown on Admin > Projects.
--
-- The Asana token is never in these tables in clear text. It is sealed (AES-GCM, GOOGLE_TOKEN_KEY) into hub_settings
-- under the key projects.asana.token.
CREATE TABLE IF NOT EXISTS hub_asana_map (
  kind TEXT NOT NULL,              -- project | section | task | story | attachment
  gid TEXT NOT NULL,               -- the Asana gid; sections and tasks from a CSV export use project gid + name or the Task ID
  hub_id TEXT NOT NULL,
  project_gid TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  asana_modified TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL,
  first_run TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (kind, gid)
);
CREATE INDEX IF NOT EXISTS idx_hub_asana_map_hub ON hub_asana_map(kind, hub_id);
CREATE TABLE IF NOT EXISTS hub_asana_deps (
  task_gid TEXT NOT NULL,          -- the task that waits
  depends_on_gid TEXT NOT NULL,    -- the task it waits for
  PRIMARY KEY (task_gid, depends_on_gid)
);
CREATE TABLE IF NOT EXISTS hub_task_fields (
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- tag | field
  name TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (task_id, kind, name, value)
);
CREATE TABLE IF NOT EXISTS hub_asana_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,              -- dry | import
  source TEXT NOT NULL,            -- api | export
  status TEXT NOT NULL,            -- running | waiting | done | failed | cancelled
  selection TEXT NOT NULL DEFAULT '[]',   -- JSON: the projects picked [{ref,name}]
  options TEXT NOT NULL DEFAULT '{}',     -- JSON: team label, visibility, incremental, upload id
  cursor TEXT NOT NULL DEFAULT '{}',      -- JSON: where the next step starts
  report TEXT NOT NULL DEFAULT '{}',      -- JSON: counts per project, people not matched, attachments not copied
  resume_at TEXT,                         -- set while waiting out a rate limit
  lock_until TEXT,                        -- one step at a time: set while a step runs
  from_dry_run TEXT,                      -- the dry run an import was confirmed from
  calls INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_asana_runs_at ON hub_asana_runs(created_at);
CREATE TABLE IF NOT EXISTS hub_asana_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',     -- info | warn | error
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_asana_log_run ON hub_asana_log(run_id, id);
