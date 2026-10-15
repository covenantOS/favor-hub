-- db/tours-step.sql (2026-10-15) The tour keeps the step each person stopped on, so Skip and Start again pick up where they left off.
-- One new column on hub_tours, nothing else changes. Run once (SQLite cannot add a column twice):
--   wrangler d1 execute favor-requests --remote --file db/tours-step.sql
-- Until it runs the server stores everything but the step and the tour starts from the first stop.
ALTER TABLE hub_tours ADD COLUMN step INTEGER NOT NULL DEFAULT 0;
