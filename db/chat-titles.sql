-- Favor Brain auto titles (2026-10-10). title_by says who set the title: 'hand' when the person typed it (never
-- overwritten), 'auto' when the Brain's small model wrote it. NULL is the first question's title from before this
-- column existed; the backfill decides which of those are untouched defaults.
ALTER TABLE brain_threads ADD COLUMN title_by TEXT;
