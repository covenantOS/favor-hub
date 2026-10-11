-- Fund and campaign requests (Admin > Appeal codes). The Fundraising API cannot create a fund or a campaign, and the guarded Blackbaud
-- route holds no rule for the NXT Data Integration call that can, so a request waits here until a person creates it in Blackbaud.
CREATE TABLE IF NOT EXISTS bb_code_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- fund | campaign
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  start_date TEXT,
  note TEXT,
  state TEXT NOT NULL DEFAULT 'open',   -- open | done | dropped
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bb_code_requests_state ON bb_code_requests(state, requested_at);
