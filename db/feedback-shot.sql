-- db/feedback-shot.sql (2026-10-10) Feedback screenshots: the R2 key of the picture a person attached, if any.
-- Run once on the favor-requests D1. The picture itself lives in the private UPLOADS bucket under feedback/<id>.jpg.
-- SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run fails on the ALTER. Run it once.

ALTER TABLE brain_feedback ADD COLUMN shot_key TEXT;
