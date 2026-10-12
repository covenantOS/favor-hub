-- db/clips-mux.sql (2026-10-11) Clips start playing at once: the state of each clip's fast-start file.
-- Run once on the favor-requests D1 after db/clips-rollout.sql. Additive only; SQLite has no ADD COLUMN IF NOT EXISTS, so a
-- second run fails on the first ALTER. Code that reads these columns treats a clip without them as "not looked at".
-- See functions/_lib/clipmuxjob.ts for what each state means.

ALTER TABLE hub_clips ADD COLUMN mux TEXT NOT NULL DEFAULT '';       -- '' | plan | done | final | skip | error
ALTER TABLE hub_clips ADD COLUMN mux_info TEXT NOT NULL DEFAULT '';  -- JSON: lengths, tracks, the upload in progress, the error
ALTER TABLE hub_clips ADD COLUMN mux_at TEXT;                        -- a run holds the clip since then; for 'done', when it finished
CREATE INDEX IF NOT EXISTS idx_hub_clips_mux ON hub_clips(mux, mux_at);
