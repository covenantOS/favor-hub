-- Moves board (2026-10-15). Additive. Apply once:
--   npx wrangler d1 execute favor-requests --remote --file db/moves.sql
-- FavorOS's own data: the stages of the major-partner pipeline, each partner's place in it, the audit trail, and relationships
-- added in FavorOS. Nothing here depends on Blackbaud, so it outlives it.

CREATE TABLE IF NOT EXISTS mv_stage (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT '',            -- 'ask' marks the stage a partner with an open ask lands in when nobody has staged them
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- One row per household (key = lr_hh.household_id, or the record id for a partner who has not given).
CREATE TABLE IF NOT EXISTS mv_card (
  key TEXT PRIMARY KEY,
  cid TEXT NOT NULL,                        -- the record the card was opened from
  stage_id TEXT NOT NULL,
  next_step TEXT,
  next_due TEXT,                            -- YYYY-MM-DD
  reminder_id TEXT,                         -- act_reminders row made for the next step
  entered_at TEXT NOT NULL,                 -- when the card reached this stage
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_mv_card_stage ON mv_card(stage_id);

CREATE TABLE IF NOT EXISTS mv_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_email TEXT,
  key TEXT,
  kind TEXT NOT NULL,                       -- move | next_step | stage_edit | relationship
  from_stage TEXT,
  to_stage TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_mv_audit_key ON mv_audit(key, at);

CREATE TABLE IF NOT EXISTS mv_relationship (
  id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  other_cid TEXT NOT NULL,
  other_name TEXT,
  type TEXT NOT NULL,
  reciprocal_type TEXT,
  position TEXT,
  bb_state TEXT NOT NULL,                   -- sent | local (FavorOS only) | failed
  bb_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (cid, other_cid, type)
);
CREATE INDEX IF NOT EXISTS idx_mv_rel_cid ON mv_relationship(cid);
CREATE INDEX IF NOT EXISTS idx_mv_rel_other ON mv_relationship(other_cid);

INSERT OR IGNORE INTO mv_stage (id, label, sort, role, active, updated_at, updated_by) VALUES
  ('identify', 'Identify', 10, '', 1, '2026-10-15T00:00:00Z', 'seed'),
  ('qualify', 'Qualify', 20, '', 1, '2026-10-15T00:00:00Z', 'seed'),
  ('cultivate', 'Cultivate', 30, '', 1, '2026-10-15T00:00:00Z', 'seed'),
  ('ask', 'Ask', 40, 'ask', 1, '2026-10-15T00:00:00Z', 'seed'),
  ('close', 'Close', 50, '', 1, '2026-10-15T00:00:00Z', 'seed'),
  ('steward', 'Steward', 60, '', 1, '2026-10-15T00:00:00Z', 'seed');
