-- 2026-10-12: partners marked no valid address in Blackbaud (mail-ready lists leave them out). Apply once; the column is in db/lists-reports.sql for new databases.
ALTER TABLE lr_hh ADD COLUMN no_addr INTEGER NOT NULL DEFAULT 0;
