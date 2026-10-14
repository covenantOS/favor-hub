-- Ring huddles and each person's recording default (2026-10-14).
-- hub_meet_rings: one row per person rung. state: ringing, joined, declined, missed (no answer, the caller hung up, or quiet
-- hours). A ring that nobody answers is missed 30 seconds after it starts (ends_at, milliseconds).
CREATE TABLE IF NOT EXISTS hub_meet_rings (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL,
  to_name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'ringing',
  why TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  answered_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS hub_meet_rings_to ON hub_meet_rings (to_email, state);
CREATE INDEX IF NOT EXISTS hub_meet_rings_meeting ON hub_meet_rings (meeting_id);
CREATE INDEX IF NOT EXISTS hub_meet_rings_open ON hub_meet_rings (state, ends_at);

-- rec: video (record video and make notes), notes (transcribe only, no video), off (neither). No row means video.
CREATE TABLE IF NOT EXISTS hub_meet_prefs (
  email TEXT PRIMARY KEY,
  rec TEXT NOT NULL DEFAULT 'video',
  updated_at TEXT NOT NULL
);
