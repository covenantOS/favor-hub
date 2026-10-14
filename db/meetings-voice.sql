-- Meetings: one transcript piece per person. The recorder cuts each participant's own track at pauses in their speech and sends
-- only the stretches with a voice in them; each piece is read under that person's name. lvl is the speech level of the piece, used
-- to tell the speaker from a copy of their voice picked up by another microphone. Additive: the mixed slices in hub_meeting_audio
-- from older pages keep working.
CREATE TABLE IF NOT EXISTS hub_meeting_voice (
  meeting_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  n INTEGER NOT NULL,
  spk_pid TEXT NOT NULL DEFAULT '',
  who TEXT NOT NULL DEFAULT '',
  lvl REAL NOT NULL DEFAULT 0,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL,
  ext TEXT NOT NULL DEFAULT 'webm',
  status TEXT NOT NULL DEFAULT 'new',
  PRIMARY KEY (meeting_id, epoch, n)
);
ALTER TABLE hub_meeting_lines ADD COLUMN lvl REAL NOT NULL DEFAULT 0;
