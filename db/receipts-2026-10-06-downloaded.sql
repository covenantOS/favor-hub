-- 2026-10-06: when the print file was first opened or downloaded, so the page and the morning email know it was printed.
ALTER TABLE rcp_batches ADD COLUMN downloaded_at TEXT;
