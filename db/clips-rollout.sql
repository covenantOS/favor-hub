-- db/clips-rollout.sql (2026-10-10) Clips for every signed-in staff member: the presenter's team, what was on screen.
-- Run once on the favor-requests D1 after db/clips-v2.sql. Additive only; SQLite has no ADD COLUMN IF NOT EXISTS, so a
-- second run fails on the first ALTER.

ALTER TABLE hub_clips ADD COLUMN owner_team TEXT NOT NULL DEFAULT '';        -- the presenter's team when the clip was started
ALTER TABLE hub_clips ADD COLUMN seen TEXT NOT NULL DEFAULT '[]';            -- JSON [{app, page, from, to}] what the screen showed, in order (no partner data)
CREATE INDEX IF NOT EXISTS idx_hub_clips_created ON hub_clips(created_at);

-- One row per sampled frame. The picture itself is deleted as soon as it is read; only these words stay, on the clip's own
-- private record, searched only in the owner's library. They are deleted with the clip.
CREATE TABLE IF NOT EXISTS hub_clip_frames (
  clip_id TEXT NOT NULL,
  t_ms INTEGER NOT NULL,                  -- position in the recording
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
  app TEXT NOT NULL DEFAULT '',           -- "Favor hub", "Blackbaud"
  page TEXT NOT NULL DEFAULT '',          -- "Request board", "Gift batch"
  text TEXT NOT NULL DEFAULT '',          -- the readable text on screen (OCR)
  step TEXT NOT NULL DEFAULT '',          -- what the person is doing
  created_at TEXT NOT NULL,
  PRIMARY KEY (clip_id, t_ms)
);
