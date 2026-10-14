-- db/brain-access.sql (2026-10-14) Favor Brain packages from FavorOS roles and teams. The Brain (favor-mcp src/access.ts)
-- reads these rules for each person's packages before grants; FavorOS Admin > People edits them. kind: everyone | role
-- (hub_users.role) | team (meet_directory.team) | lead (meet_directory.lead, key = a team or empty for any) | person (email).
CREATE TABLE IF NOT EXISTS brain_access_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key TEXT NOT NULL DEFAULT '',
  package TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (kind, key, package)
);
