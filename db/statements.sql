-- Giving statements. A batch is one print file: a single statement made on request, or up to a few hundred of the
-- January year-end statements. stm_issued is the run record: one row per partner per year, so a second run never
-- prints the same partner twice. Additive only. Not applied to production by the build.

CREATE TABLE IF NOT EXISTS stm_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                           -- single | yearend
  list TEXT NOT NULL DEFAULT '',                -- yearend: mail | email | other
  year INTEGER,                                 -- yearend: the gift year
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  include_soft INTEGER NOT NULL DEFAULT 0,      -- the through-a-fund section is on
  count INTEGER NOT NULL DEFAULT 0,             -- statements in the file
  gifts INTEGER NOT NULL DEFAULT 0,             -- gifts the statements list
  amount_cents INTEGER NOT NULL DEFAULT 0,      -- net totals of the statements
  basis_cents INTEGER NOT NULL DEFAULT 0,       -- what the tax lists add up for the same partners
  skipped INTEGER NOT NULL DEFAULT 0,           -- partners on the list with nothing to print
  seq INTEGER NOT NULL DEFAULT 1,               -- file number within the list and year
  pdf_key TEXT NOT NULL,
  partners TEXT NOT NULL,                       -- JSON: id, lookup, name, cents, basis, email
  copy TEXT NOT NULL,                           -- JSON: the wording used
  status TEXT NOT NULL DEFAULT 'printing',      -- single: made. yearend: printing | printed | discarded
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  printed_by TEXT NOT NULL DEFAULT '',
  printed_at TEXT,
  downloaded_at TEXT,
  drive_file TEXT NOT NULL DEFAULT ''           -- Drive file id of the copy in US Team Files, when that setting is on
);

CREATE INDEX IF NOT EXISTS idx_stm_batches_created ON stm_batches(created_at);
CREATE INDEX IF NOT EXISTS idx_stm_batches_kind ON stm_batches(kind, status);

CREATE TABLE IF NOT EXISTS stm_issued (
  year INTEGER NOT NULL,
  cid TEXT NOT NULL,                            -- Blackbaud system id of the partner
  list TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  cents INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  PRIMARY KEY (year, cid)
);

CREATE INDEX IF NOT EXISTS idx_stm_issued_batch ON stm_issued(batch_id);

CREATE TABLE IF NOT EXISTS stm_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  batch_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);

-- One row per email the hub sent (or tried to send) with a statement attached. Empty while the email setting is off.
CREATE TABLE IF NOT EXISTS stm_emails (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  cid TEXT NOT NULL,
  to_email TEXT NOT NULL,
  status TEXT NOT NULL,                         -- sent | failed
  detail TEXT NOT NULL DEFAULT '',
  sent_by TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stm_emails_batch ON stm_emails(batch_id);
