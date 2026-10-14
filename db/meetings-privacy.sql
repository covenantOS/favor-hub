-- Meetings: private moments, cuts and removed Drive files (2026-10-14). Apply to favor-requests.
-- A private moment: while to_t is null the hub stores no sound slice and no recording piece for the meeting. Times are seconds from the start.
CREATE TABLE IF NOT EXISTS hub_meeting_private (
  meeting_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  from_t INTEGER NOT NULL,
  to_t INTEGER,
  by_email TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, n)
);
-- Each cut of a stretch of a finished meeting, and each deleted recording, with who did it.
CREATE TABLE IF NOT EXISTS hub_meeting_cuts (
  meeting_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  kind TEXT NOT NULL,                     -- cut | recording
  from_t INTEGER NOT NULL DEFAULT 0,
  to_t INTEGER,                           -- null runs to the end
  by_email TEXT NOT NULL,
  at TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (meeting_id, n)
);
-- Drive files taken out: trashed, or emptied and renamed when the service account may not trash (Contributor on US Team Files).
CREATE TABLE IF NOT EXISTS hub_meeting_removed (
  file_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- recording | notes
  name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,                    -- trashed | emptied | gone
  by_email TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_removed_meeting ON hub_meeting_removed(meeting_id);
-- 1 while a private moment is on, read with the meeting on every room sync and recorder upload (no extra read).
ALTER TABLE hub_meetings ADD COLUMN private_on INTEGER NOT NULL DEFAULT 0;
