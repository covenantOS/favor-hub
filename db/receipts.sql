-- Thank-you receipts. Replaces the Database View mail task, the CSV clean-up
-- and the three InDesign files. A batch is one printing: the gifts in it, the
-- print file in R2, and which gifts are marked thanked in Blackbaud. Marking
-- happens after printing, so a print that fails never loses a gift.

CREATE TABLE IF NOT EXISTS rcp_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rcp_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'new',             -- new | reprint
  letter_date TEXT NOT NULL,                    -- YYYY-MM-DD printed on the letters
  appeal_code TEXT NOT NULL,                    -- reply code on the slip, e.g. Y26A-TY
  count INTEGER NOT NULL,                       -- letters, one per partner
  gifts INTEGER NOT NULL DEFAULT 0,             -- gifts the letters cover
  amount REAL NOT NULL DEFAULT 0,
  regular INTEGER NOT NULL DEFAULT 0,
  major INTEGER NOT NULL DEFAULT 0,
  recurring INTEGER NOT NULL DEFAULT 0,
  first_gift TEXT NOT NULL DEFAULT '',
  last_gift TEXT NOT NULL DEFAULT '',
  source_date TEXT NOT NULL DEFAULT '',         -- reprint: the day the gifts were marked
  pdf_key TEXT NOT NULL,
  letters TEXT NOT NULL,                        -- JSON, what each page prints
  copy TEXT NOT NULL,                           -- JSON, the letter wording used
  marked INTEGER NOT NULL DEFAULT 0,
  mark_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'printing',      -- printing | marking | done | reprint | cancelled
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  marked_by TEXT NOT NULL DEFAULT '',
  marked_at TEXT,
  downloaded_at TEXT                            -- first time the print file itself was opened or downloaded
);

CREATE INDEX IF NOT EXISTS idx_rcp_batches_created ON rcp_batches(created_at);

CREATE TABLE IF NOT EXISTS rcp_batch_gifts (
  batch_id TEXT NOT NULL,
  gift_id TEXT NOT NULL,                        -- Blackbaud system id
  state TEXT NOT NULL DEFAULT 'waiting',        -- waiting | marked | failed
  detail TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, gift_id)
);

CREATE INDEX IF NOT EXISTS idx_rcp_batch_gifts_gift ON rcp_batch_gifts(gift_id);

CREATE TABLE IF NOT EXISTS rcp_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rcp_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  batch_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
