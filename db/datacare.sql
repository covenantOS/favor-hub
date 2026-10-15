-- db/datacare.sql (2026-10-14) Data care: partners who gave in the last 12 months with no mailable address, and possible duplicate
-- pairs. Both lists are rebuilt from the RE NXT mirror by functions/_lib/datacare/scan.ts; staff decisions are kept across rebuilds.
CREATE TABLE IF NOT EXISTS dc_flag (
  cid TEXT PRIMARY KEY,                   -- Blackbaud system record id
  lookup TEXT NOT NULL,                   -- the id staff see (Constituent ID)
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'no_address',
  why TEXT NOT NULL DEFAULT '',           -- dnm | no_street | inactive | none
  state TEXT NOT NULL DEFAULT 'open',     -- open | fixed
  gave REAL NOT NULL DEFAULT 0,           -- given in the 12 months before first_seen's last scan
  gifts INTEGER NOT NULL DEFAULT 0,
  last_gift TEXT,
  email TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  fixed_at TEXT,
  fixed_how TEXT,
  task_id TEXT                            -- the review task assigned to the reviewer
);
CREATE INDEX IF NOT EXISTS idx_dc_flag_state ON dc_flag(state, kind);

CREATE TABLE IF NOT EXISTS dc_pair (
  id TEXT PRIMARY KEY,                    -- "<a>-<b>", system ids, a < b numerically
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  a_lookup TEXT, b_lookup TEXT, a_name TEXT, b_name TEXT,
  score INTEGER NOT NULL,
  why TEXT NOT NULL,                      -- "Same email, names match"
  state TEXT NOT NULL DEFAULT 'review',   -- review | not_same | queued | merged | failed
  keep TEXT,                              -- the record that stays
  picks TEXT,                             -- JSON: where the name and the contact details come from (a | b)
  decided_by TEXT,
  decided_at TEXT,
  done_at TEXT,
  result TEXT,
  found_at TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dc_pair_state ON dc_pair(state, score);

CREATE TABLE IF NOT EXISTS dc_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  at TEXT NOT NULL
);
