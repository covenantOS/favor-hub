-- db/clip-share.sql (2026-10-14) One sharing level per clip: private, people, staff or public. NULL means the owner never set it, so the older
-- share and staff_link switches and the grandfathered viewers decide (functions/_lib/clips.ts, levelOf and mayWatch).
ALTER TABLE hub_clips ADD COLUMN access TEXT;
