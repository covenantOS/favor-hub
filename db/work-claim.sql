-- db/work-claim.sql (2026-10-10) The outbox claim. A row is claimed (state sending, claimed_at) before it goes to Blackbaud,
-- so two runs cannot send the same row even when the batch lock's two-minute lease runs out during a slow send.
-- Run once on the favor-requests D1, before the code that reads claimed_at ships. Fresh databases get the column from db/work.sql.
-- The column is nullable and nothing is rewritten, so the code before this change keeps working on the migrated table.
-- SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run fails on the ALTER. Run it once.

ALTER TABLE act_outbox ADD COLUMN claimed_at TEXT;
