-- Google Sheets export (2026-10-09). One row per sheet the hub made for a person, with counts and the
-- kind of information it held, never the values. hub_sheets_folder remembers each person's "Favor
-- exports" folder in their own Drive. Run before the first deploy that builds sheets.
CREATE TABLE IF NOT EXISTS hub_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  email TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  via TEXT NOT NULL,
  tabs INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  classes TEXT NOT NULL DEFAULT '',
  needs TEXT NOT NULL DEFAULT '',
  dedupe TEXT,
  private INTEGER NOT NULL DEFAULT 1,
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_hub_sheets_email_at ON hub_sheets (email, at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_sheets_dedupe ON hub_sheets (email, dedupe) WHERE dedupe IS NOT NULL;
CREATE TABLE IF NOT EXISTS hub_sheets_folder (
  email TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
