-- Growth: practice mode (2026-10-12). Additive only.
--   practice_entries   what a person typed into the practice partner record: a pretend gift or a pretend call.
-- Nothing in this table is a Blackbaud record and nothing here is ever sent to Blackbaud. The pretend partner lives in
-- functions/_lib/growth/practice.ts and is invented.

CREATE TABLE IF NOT EXISTS practice_entries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- gift | call
  data TEXT NOT NULL,                  -- the fields typed, as JSON
  ok INTEGER NOT NULL DEFAULT 0,       -- 1 when every check passed
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_practice_email ON practice_entries(email, kind, created_at);
