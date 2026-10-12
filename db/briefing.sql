-- db/briefing.sql (2026-10-12) Today briefing: when each person last used FavorOS, so "Since you were away" knows what changed.
-- Additive only (one new table). Apply with
--   npx wrangler d1 execute favor-requests --remote --file db/briefing.sql
-- The routes read a missing table as "no history", so Today works before this runs.
CREATE TABLE IF NOT EXISTS brief_seen (
  email TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL,          -- last time Today was opened
  away_from TEXT,                 -- when the visit before this one ended
  session_at TEXT NOT NULL,       -- when this visit began
  dismissed_at TEXT               -- when the person closed the Since you were away card for this visit
);
