-- db/clips-v2.sql (2026-10-10) Clips v2: transcript, auto title and summary, chapters, edits, comments, reactions, views.
-- Run once on the favor-requests D1 after db/clips.sql. Every statement adds something; nothing is dropped or rewritten.
-- SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run fails on the first ALTER. Run it once.

ALTER TABLE hub_clips ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE hub_clips ADD COLUMN kind TEXT NOT NULL DEFAULT 'screen';            -- screen | camera | upload
ALTER TABLE hub_clips ADD COLUMN parts TEXT NOT NULL DEFAULT '[]';               -- JSON [{n, etag, size}] while uploading
ALTER TABLE hub_clips ADD COLUMN audio_segments TEXT NOT NULL DEFAULT '[]';      -- JSON [{n, start, size, ext}]
ALTER TABLE hub_clips ADD COLUMN transcript TEXT NOT NULL DEFAULT '[]';          -- JSON [{s, e, t}] seconds in the source file
ALTER TABLE hub_clips ADD COLUMN words TEXT NOT NULL DEFAULT '[]';               -- JSON [[start, end, word]]
ALTER TABLE hub_clips ADD COLUMN chapters TEXT NOT NULL DEFAULT '[]';            -- JSON [{at, title}]
ALTER TABLE hub_clips ADD COLUMN edits TEXT NOT NULL DEFAULT '{}';               -- JSON {trimStart, trimEnd, cuts, silences, fillers, splits}
ALTER TABLE hub_clips ADD COLUMN help_draft TEXT NOT NULL DEFAULT '';            -- the last help article drafted from the clip (markdown)
ALTER TABLE hub_clips ADD COLUMN error TEXT;
ALTER TABLE hub_clips ADD COLUMN translations TEXT NOT NULL DEFAULT '{}';        -- JSON {es: [line, ...], en: [...]} the transcript in another language, one string per line
ALTER TABLE hub_clips ADD COLUMN proc_at TEXT;                                   -- when a processing run started; stops two runs from doing the same work
ALTER TABLE hub_clips ADD COLUMN title_auto INTEGER NOT NULL DEFAULT 0;          -- 1 while the title is the one the transcript produced

CREATE TABLE IF NOT EXISTS hub_clip_comments (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  at_seconds REAL NOT NULL DEFAULT 0,
  author_email TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_clip_comments_clip ON hub_clip_comments(clip_id, at_seconds);

CREATE TABLE IF NOT EXISTS hub_clip_reactions (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  person_email TEXT NOT NULL,
  person_name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  at_seconds REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (clip_id, person_email, emoji)
);
CREATE INDEX IF NOT EXISTS idx_hub_clip_reactions_clip ON hub_clip_reactions(clip_id, at_seconds);

CREATE TABLE IF NOT EXISTS hub_clip_views (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  person_email TEXT NOT NULL,         -- 'link' for someone watching through the share link without signing in
  person_name TEXT NOT NULL,
  at TEXT NOT NULL,
  seconds REAL NOT NULL DEFAULT 0     -- the furthest point reached, in source seconds
);
CREATE INDEX IF NOT EXISTS idx_hub_clip_views_clip ON hub_clip_views(clip_id, at);
