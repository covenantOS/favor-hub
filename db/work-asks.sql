-- db/work-asks.sql (2026-10-10) Ask pipeline: the close date a director sets on an ask. The ask itself is an action tagged Amount of Ask
-- in Blackbaud (read from the mirror); this table holds only the expected close date. No row means no close date.
CREATE TABLE IF NOT EXISTS act_ask_close (
  action_id TEXT PRIMARY KEY,            -- the Blackbaud action carrying the Amount of Ask tag
  expected_close TEXT NOT NULL,          -- YYYY-MM-DD
  set_by TEXT NOT NULL,                  -- name
  set_by_email TEXT NOT NULL,
  set_at TEXT NOT NULL
);

-- Actions found deleted in Blackbaud (read live, answered 404). The mirror keeps deleted rows, so the board leaves these out.
CREATE TABLE IF NOT EXISTS act_ask_gone (
  action_id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL
);
