-- db/meetings-auto.sql (2026-10-12) Meetings that work before, during and after the call.
-- Run once on the favor-requests D1, before the code that reads these is deployed. Additive only.
-- The two ALTER lines fail with "duplicate column name" on a database that already has them and can be skipped there.

-- The chat channel a finished meeting's summary is posted to (chosen when booking, empty for none) and whether that post went out.
ALTER TABLE hub_meetings ADD COLUMN post_channel TEXT NOT NULL DEFAULT '';
ALTER TABLE hub_meetings ADD COLUMN summary_posted INTEGER NOT NULL DEFAULT 0;

-- Decisions and action items caught while the call is still going, from the live transcript. The notes pass at the end of the
-- meeting reads these (kept items stay, dismissed ones do not come back) and writes the final list.
CREATE TABLE IF NOT EXISTS hub_meeting_live (
  meeting_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'action',    -- action | decision
  text TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',
  t INTEGER NOT NULL DEFAULT 0,           -- seconds from the start of the meeting
  dismissed INTEGER NOT NULL DEFAULT 0,
  by_hand INTEGER NOT NULL DEFAULT 0,     -- 1 when a person typed it in
  PRIMARY KEY (meeting_id, idx)
);
-- How far the live reading has gone: the last transcript line read and when, which also serves as the lock between two readers.
CREATE TABLE IF NOT EXISTS hub_meeting_live_state (
  meeting_id TEXT PRIMARY KEY,
  upto_n INTEGER NOT NULL DEFAULT -1,
  at_ms INTEGER NOT NULL DEFAULT 0
);

-- Partners a meeting may be logged against in Blackbaud. A row starts as proposed (an invitee's email matched a partner, or the
-- host added one). Nothing goes to Blackbaud until the host presses Log in Blackbaud, and the row then records who, when and which batch.
CREATE TABLE IF NOT EXISTS hub_meeting_partner (
  meeting_id TEXT NOT NULL,
  cid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'email',   -- email | host
  state TEXT NOT NULL DEFAULT 'proposed', -- proposed | logged | dismissed | failed
  summary TEXT NOT NULL DEFAULT '',
  batch_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  PRIMARY KEY (meeting_id, cid)
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_partner_state ON hub_meeting_partner(state, meeting_id);
