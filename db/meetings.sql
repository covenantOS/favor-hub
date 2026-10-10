-- db/meetings.sql (2026-10-10) Favor meetings: rooms on the Cloudflare Realtime SFU, booking, recording, notes.
-- Run once on the favor-requests D1. Additive only (new tables). Phase 1 uses the first four tables.

CREATE TABLE IF NOT EXISTS hub_meetings (
  id TEXT PRIMARY KEY,                    -- 24 hex, unguessable; the room link is /meet/room/?m=<id>
  title TEXT NOT NULL,
  agenda TEXT NOT NULL DEFAULT '',
  host_email TEXT NOT NULL,
  host_name TEXT NOT NULL DEFAULT '',
  cohosts TEXT NOT NULL DEFAULT '[]',     -- JSON array of emails the host made hosts
  starts_at TEXT,                         -- ISO UTC; null for "start a meeting now"
  ends_at TEXT,
  duration_min INTEGER NOT NULL DEFAULT 60,
  rec_mode TEXT NOT NULL DEFAULT 'notes', -- off | notes | video
  access TEXT NOT NULL DEFAULT 'invited', -- invited | staff | guests
  invitees TEXT NOT NULL DEFAULT '[]',    -- JSON [{email, name, team, guest}]
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | live | ended | cancelled
  locked INTEGER NOT NULL DEFAULT 0,
  spot_pid TEXT NOT NULL DEFAULT '',      -- who the host spotlighted for everyone
  share_policy TEXT NOT NULL DEFAULT 'all', -- all | hosts: who may share a screen
  repeat TEXT NOT NULL DEFAULT 'none',
  series_id TEXT NOT NULL DEFAULT '',
  calendar_event_id TEXT NOT NULL DEFAULT '',
  backup_link TEXT NOT NULL DEFAULT '',
  remind INTEGER NOT NULL DEFAULT 1,
  rec_state TEXT NOT NULL DEFAULT 'none', -- none | recording | uploading | stored | failed
  drive_file_id TEXT NOT NULL DEFAULT '',
  drive_folder TEXT NOT NULL DEFAULT '',
  notes_status TEXT NOT NULL DEFAULT 'none', -- none | pending | ready | failed
  summary TEXT NOT NULL DEFAULT '',
  notes_json TEXT NOT NULL DEFAULT '{}',  -- decisions, action items, chapters
  transcript TEXT NOT NULL DEFAULT '',    -- JSON [{t, who, text}]
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_meetings_start ON hub_meetings(starts_at);
CREATE INDEX IF NOT EXISTS idx_hub_meetings_host ON hub_meetings(host_email);

-- Who is in the room now. One row per join; a person who rejoins keeps the same pid.
CREATE TABLE IF NOT EXISTS hub_meeting_presence (
  meeting_id TEXT NOT NULL,
  pid TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',     -- host | cohost | staff | guest
  session_id TEXT NOT NULL DEFAULT '',    -- the SFU session
  tracks TEXT NOT NULL DEFAULT '[]',      -- JSON [{name, kind, mid}]
  mic INTEGER NOT NULL DEFAULT 1,
  cam INTEGER NOT NULL DEFAULT 1,
  hand INTEGER NOT NULL DEFAULT 0,
  sharing INTEGER NOT NULL DEFAULT 0,
  can_share INTEGER NOT NULL DEFAULT 1,
  lvl INTEGER NOT NULL DEFAULT 0,         -- 0..100 sound level, for the speaking ring
  speak_at INTEGER NOT NULL DEFAULT 0,    -- last time this person was speaking (ms)
  waiting INTEGER NOT NULL DEFAULT 0,     -- a guest the host has not let in
  removed INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  left_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, pid)
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_presence_sess ON hub_meeting_presence(session_id);

-- Chat and host commands, in order. Clients poll with the last seq they saw.
CREATE TABLE IF NOT EXISTS hub_meeting_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- chat | cmd | react | brain | notice
  from_pid TEXT NOT NULL DEFAULT '',
  to_pid TEXT NOT NULL DEFAULT '',        -- '' means everyone
  body TEXT NOT NULL DEFAULT '{}',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_events_m ON hub_meeting_events(meeting_id, seq);

-- Recording chunks as the host's browser sends them. epoch changes when a second person takes over.
CREATE TABLE IF NOT EXISTS hub_meeting_rec (
  meeting_id TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL,
  owner_pid TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'video',
  active INTEGER NOT NULL DEFAULT 1,
  last_chunk INTEGER NOT NULL,
  started INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_meeting_chunks (
  meeting_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  t0 INTEGER NOT NULL,
  t1 INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, epoch, seq)
);

-- Sound pieces for the transcript: the recorder's browser cuts the meeting sound into pieces of about four minutes, each a file
-- that plays on its own, and sends each one up. Whisper reads a piece at a time.
CREATE TABLE IF NOT EXISTS hub_meeting_audio (
  meeting_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  n INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,              -- wall clock when the piece started
  end_ms INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL,
  ext TEXT NOT NULL DEFAULT 'webm',
  status TEXT NOT NULL DEFAULT 'new',     -- new | done | failed
  PRIMARY KEY (meeting_id, epoch, n)
);
-- Where the recording is on its way to Google Drive: one row per epoch (a takeover starts a new epoch and a new file).
CREATE TABLE IF NOT EXISTS hub_meeting_drive (
  meeting_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  session_url TEXT NOT NULL DEFAULT '',
  next_seq INTEGER NOT NULL DEFAULT 0,    -- next chunk to send
  sent_bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  file_id TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  ext TEXT NOT NULL DEFAULT 'webm',
  state TEXT NOT NULL DEFAULT 'open',     -- open | done | failed
  PRIMARY KEY (meeting_id, epoch)
);
