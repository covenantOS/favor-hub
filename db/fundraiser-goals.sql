-- db/fundraiser-goals.sql (2026-10-14) Fundraiser goals, kept in FavorOS. One row per fundraiser (Blackbaud fundraiser id) and year.
-- Seeded from the Blackbaud copy's fundraisers columns, edited by admins at /admin/goals/. The source switch is the hub setting goals.source.
CREATE TABLE IF NOT EXISTS fundraiser_goals (
  fundraiser_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  annual_goal REAL,
  q1_goal REAL,
  q2_goal REAL,
  q3_goal REAL,
  q4_goal REAL,
  prev_q4_goal REAL,
  note TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fundraiser_id, year)
);
