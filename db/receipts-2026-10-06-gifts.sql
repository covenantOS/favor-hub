-- 2026-10-06: one letter per partner, so a print file's gift count is kept beside its letter count.
ALTER TABLE rcp_batches ADD COLUMN gifts INTEGER NOT NULL DEFAULT 0;
