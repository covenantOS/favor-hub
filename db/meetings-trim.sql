-- Meetings: cutting stretches out of a recording in Drive (2026-10-14). Apply to favor-requests after meetings-privacy.sql.
-- One job per recording file. cuts are milliseconds of the file as it is now ([from, to], to null for the end). holes are byte offsets
-- of the original file where pieces were never stored (a private moment). st is the trimmer's place in the file between turns.
CREATE TABLE IF NOT EXISTS hub_meeting_trim (
  meeting_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  cuts TEXT NOT NULL,
  holes TEXT NOT NULL DEFAULT '[]',
  rev TEXT NOT NULL DEFAULT '',
  src_size INTEGER NOT NULL DEFAULT 0,
  session_url TEXT NOT NULL DEFAULT '',
  out_sent INTEGER NOT NULL DEFAULT 0,
  st TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'run',      -- run | done | failed
  lease INTEGER NOT NULL DEFAULT 0,
  tries INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  by_email TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, epoch)
);
-- The cuts already made to each file, oldest first, each a list of [from, to] in milliseconds of the file as it was then.
ALTER TABLE hub_meeting_drive ADD COLUMN trims TEXT NOT NULL DEFAULT '[]';
