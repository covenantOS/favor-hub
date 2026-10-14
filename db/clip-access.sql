-- db/clip-access.sql (2026-10-14) Clips open only for the people they are shared with. staff_link is the "Anyone at Favor
-- with the link" switch, off for every clip; hub_clip_people holds people added by name. Members of a Chat conversation a clip
-- was posted in, admins, and people who watched a clip before this change (hub_clip_views) keep access (functions/_lib/clips.ts).
ALTER TABLE hub_clips ADD COLUMN staff_link INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS hub_clip_people (
  clip_id TEXT NOT NULL,
  email TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (clip_id, email)
);
CREATE INDEX IF NOT EXISTS idx_hub_clip_people_email ON hub_clip_people(email);
