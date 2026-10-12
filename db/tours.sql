-- db/tours.sql (2026-10-11) The guided tour and the New in FavorOS walkthroughs: what each person has seen.
-- Additive only: one new table, nothing in an existing table changes. Idempotent. Not applied by the lane. Apply with
--   wrangler d1 execute favor-requests --remote --file db/tours.sql
-- Until this table exists FavorOS keeps each person's progress in their browser, and sends it here the first time
-- the table answers. Item names: core | r:<release day> | f:<release day>.<feature> (src/scripts/tour-state.ts).
CREATE TABLE IF NOT EXISTS hub_tours (
  email TEXT NOT NULL,
  item TEXT NOT NULL,
  state TEXT NOT NULL,                 -- offered | snoozed | done | queued
  snoozes INTEGER NOT NULL DEFAULT 0,  -- times the person pressed Skip for now
  snooze_until TEXT,                   -- YYYY-MM-DD, Eastern: stays closed until this day
  updated_at TEXT NOT NULL,            -- when the state last changed
  first_at TEXT NOT NULL,              -- when the person was first shown it
  done_at TEXT,
  queued_by TEXT,                      -- the admin who pressed Send again
  PRIMARY KEY (email, item)
);
CREATE INDEX IF NOT EXISTS idx_hub_tours_item ON hub_tours(item, state);
