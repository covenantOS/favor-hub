-- Requests inside Projects (2026-10-14). Additive only: two new tables, nothing in an existing table changes.
-- Apply with: wrangler d1 execute favor-requests --remote --file db/projects-intake.sql
-- A request stays in `requests` (its words, files, history and conversation). Its card is a hub_tasks row with request_id set, sitting
-- in the Intake section of its team's pipeline project. These tables hold what the card needs beyond that.

-- The pipeline project each team owns. Intake, Triage, In progress, Review and Done are its sections. A pipeline project is never
-- synced with Asana (setProjectSync refuses it), so requests never make noise there; a card accepted into a synced project does.
CREATE TABLE IF NOT EXISTS hub_intake_teams (
  team TEXT PRIMARY KEY,                    -- tech | marketing
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per request that has a card. The chips are what the composer sent, kept so a card can say why it was sorted that way.
CREATE TABLE IF NOT EXISTS hub_intake (
  request_id TEXT PRIMARY KEY,
  task_id TEXT,
  team TEXT NOT NULL,                       -- tech | marketing
  kind TEXT NOT NULL DEFAULT 'other',       -- change | add | other
  place TEXT NOT NULL DEFAULT '',           -- website | portal | dashboard | app, or design | print | social | video | email | event
  audience TEXT NOT NULL DEFAULT '',
  needed TEXT NOT NULL DEFAULT '',
  assignee_hint TEXT,                       -- the person the asker named, an email; the owner is chosen at Accept
  chips TEXT NOT NULL DEFAULT '{}',         -- JSON: each chip's value, label and reason as sent
  question_open INTEGER NOT NULL DEFAULT 0, -- 1 from Ask a question until the asker answers
  question_at TEXT,
  decided_by TEXT,                          -- who accepted or declined, an email
  decided_at TEXT,
  migrated INTEGER NOT NULL DEFAULT 0,      -- 1 for a request brought over from the old board
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_intake_task ON hub_intake(task_id);
CREATE INDEX IF NOT EXISTS idx_hub_intake_team ON hub_intake(team, question_open);
