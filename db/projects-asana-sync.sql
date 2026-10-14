-- Two-way Asana sync for Projects (functions/_lib/projects/sync.ts). New tables only; hub_asana_map from projects-asana.sql keeps the gid to hub id map.
-- The projects that sync, one row per Asana project. enabled = 0 keeps the row (and its webhook is removed).
CREATE TABLE IF NOT EXISTS hub_asana_sync_projects (
  project_gid TEXT PRIMARY KEY,
  hub_project_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  webhook_gid TEXT,
  webhook_secret TEXT,              -- sealed with GOOGLE_TOKEN_KEY
  webhook_at TEXT,
  last_event_at TEXT,
  last_reconcile TEXT,              -- ISO time the last reconcile read Asana up to
  sub_cursor INTEGER NOT NULL DEFAULT 0,
  enabled_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- The last values both sides agreed on, per task: the base for a three-way merge (a field changed on one side only goes across;
-- changed on both, the later edit wins and the log says so).
CREATE TABLE IF NOT EXISTS hub_asana_snap (
  gid TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_asana_snap_hub ON hub_asana_snap(hub_id);
-- Changes waiting to go to Asana. One row per hub change; the pass sends them oldest first under the rate limit.
CREATE TABLE IF NOT EXISTS hub_asana_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,               -- task | comment | file | people | delete
  hub_id TEXT NOT NULL,             -- task id (comment, file: the task id; ref holds the comment or file id)
  ref TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | working | done | failed
  tries INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_asana_outbox_q ON hub_asana_outbox(status, next_at);
-- Asana webhook events waiting to be read in (task or story gids). Kept a week.
CREATE TABLE IF NOT EXISTS hub_asana_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_gid TEXT NOT NULL,
  type TEXT NOT NULL,               -- task | story | attachment | section
  gid TEXT NOT NULL,
  parent_gid TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | done | skipped | failed
  tries INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_asana_inbox_q ON hub_asana_inbox(status, next_at);
-- Every change the sync made, both directions, and every conflict it settled.
CREATE TABLE IF NOT EXISTS hub_asana_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  dir TEXT NOT NULL,                -- in | out | conflict | error | info
  gid TEXT NOT NULL DEFAULT '',
  hub_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_asana_sync_log_at ON hub_asana_sync_log(at);
-- Connect Asana, per person: edits that person makes in FavorOS reach Asana under their own Asana account.
CREATE TABLE IF NOT EXISTS hub_asana_oauth (
  email TEXT PRIMARY KEY,
  asana_gid TEXT NOT NULL,
  asana_name TEXT NOT NULL DEFAULT '',
  asana_email TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL,      -- sealed
  access_token TEXT NOT NULL DEFAULT '',   -- sealed
  expires_at TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  refreshed_at TEXT
);
