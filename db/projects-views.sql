-- Projects: saved views per person (2026-10-14). Additive only: one new table, nothing changed.
-- Apply with: wrangler d1 execute favor-requests --remote --file db/projects-views.sql  (after db/projects.sql)
-- A saved view is the filter bar of a project list or board (or of My tasks, with no project) under a name, owned by one person.
--   query  JSON of the filter: { q, owner, due, status, code, priority, show_done, view }
CREATE TABLE IF NOT EXISTS hub_task_views (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_task_views_owner ON hub_task_views(email, project_id);
