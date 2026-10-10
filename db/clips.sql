-- db/clips.sql (2026-10-10) Clips: short screen recordings with a share link. The video lives in the private
-- R2 bucket favor-clips under clips/<id>/video and clips/<id>/poster.
CREATE TABLE IF NOT EXISTS hub_clips (
  id TEXT PRIMARY KEY,                 -- 32 hex characters, 128 random bits, the share link
  owner_email TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading',  -- uploading | ready
  share INTEGER NOT NULL DEFAULT 0,    -- 1 = anyone with the link, signed in or not
  mime TEXT NOT NULL,
  upload_id TEXT,                      -- R2 multipart upload id while uploading
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  has_poster INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_clips_owner ON hub_clips(owner_email, created_at);
