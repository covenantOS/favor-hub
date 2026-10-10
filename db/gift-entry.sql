-- db/gift-entry.sql (2026-10-10) Gift entry, the mail day (ge_ prefix, hub database favor-requests).
-- The hub keeps its own state here. It holds no Blackbaud data other than the ids Blackbaud hands back, and no bank numbers:
-- a payer's routing and account line is never read into text. Option B (Will, 2026-10-10): the hub creates an UNAPPROVED batch in
-- Blackbaud and Jennifer approves it there, so the hub has no approval step and no approval column.

CREATE TABLE IF NOT EXISTS ge_deposit (
  id TEXT PRIMARY KEY,                             -- newId('gd')
  kind TEXT NOT NULL CHECK (kind IN ('regular', 'acquisition', 'grant')),
  name TEXT NOT NULL,                              -- 'Regular Mail 2026-10-09', built by the system
  deposit_date TEXT NOT NULL,                      -- YYYY-MM-DD, also the gift date
  tape_cents INTEGER NOT NULL,
  tape_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',             -- open | sending | created | committed | needs_person | removed
  created_by TEXT NOT NULL, created_by_email TEXT NOT NULL, created_at TEXT NOT NULL,
  sent_by TEXT, sent_at TEXT,
  bb_batch_id TEXT, bb_batch_number TEXT,          -- from Blackbaud when the batch is made
  committed_at TEXT, committed_by TEXT,            -- read from the batch (approved) and the first gift's Added By
  last_polled_at TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_ge_deposit_created ON ge_deposit(created_at);

CREATE TABLE IF NOT EXISTS ge_gift (
  id TEXT PRIMARY KEY,                             -- newId('gg'); rides in the Blackbaud Reference as 'hub gg_...'
  deposit_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reading',          -- reading | review | ready | sent | failed | removed
  kind TEXT NOT NULL DEFAULT 'check',              -- check | cash
  partner_id TEXT, partner_lookup TEXT, partner_name TEXT, partner_place TEXT,
  amount_cents INTEGER,
  gift_date TEXT,                                  -- the deposit date unless a person changes it
  check_number TEXT, check_date TEXT,              -- YYYY-MM-DD
  payer TEXT, memo TEXT,
  fund_id TEXT, fund_name TEXT, appeal_id TEXT, appeal_name TEXT,
  soft_partner_id TEXT, soft_partner_name TEXT,
  rule TEXT,                                       -- why the image copies to Blackbaud: designated | big | giving_fund | letter | ''
  prayer INTEGER NOT NULL DEFAULT 0,
  fields_json TEXT,                                -- what each reader said and which fields they disagree on
  candidates_json TEXT,                            -- partner candidates the matcher proposed
  dup_json TEXT,                                   -- why the duplicate guard flagged it
  dedupe_key TEXT,
  confirmed_by TEXT, confirmed_at TEXT,            -- the human glance: nobody sends a row nobody has looked at
  bb_batch_gift_id TEXT, bb_gift_id TEXT,          -- batch gift id from the post; the real gift id exists only after commit
  error TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ge_gift_deposit ON ge_gift(deposit_id, seq);
CREATE INDEX IF NOT EXISTS idx_ge_gift_dedupe ON ge_gift(dedupe_key);

CREATE TABLE IF NOT EXISTS ge_image (
  id TEXT PRIMARY KEY,                             -- newId('gi')
  gift_id TEXT NOT NULL, deposit_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'check_front',        -- check_front | slip | letter
  r2_key TEXT NOT NULL,                            -- private bucket favor-gift-captures
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/jpeg',
  uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL,
  copy_to_bb INTEGER NOT NULL DEFAULT 0,           -- 1 for a rule gift
  bb_file_id TEXT, bb_attachment_id TEXT, attached_at TEXT, attach_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ge_image_gift ON ge_image(gift_id);
CREATE INDEX IF NOT EXISTS idx_ge_image_sha ON ge_image(sha256);

CREATE TABLE IF NOT EXISTS ge_read (                -- redacted text only: no routing or account line, no card number
  id TEXT PRIMARY KEY, image_id TEXT NOT NULL, model TEXT NOT NULL,
  fields_json TEXT NOT NULL, secs REAL, error TEXT, read_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ge_read_image ON ge_read(image_id);

CREATE TABLE IF NOT EXISTS ge_event (               -- append only; no code path updates or deletes a row
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, deposit_id TEXT, gift_id TEXT,
  kind TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_ge_event_deposit ON ge_event(deposit_id, id);

CREATE TABLE IF NOT EXISTS ge_outbox (              -- one Blackbaud step per row; UNIQUE (deposit, op) so a step never queues twice
  id TEXT PRIMARY KEY,
  deposit_id TEXT NOT NULL,
  op TEXT NOT NULL,                                -- batch | gifts:<n> | attach:<image id>
  status TEXT NOT NULL DEFAULT 'queued',           -- queued | done | failed | waiting
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT,
  result_json TEXT,
  last_error_class TEXT, last_error TEXT,
  created_at TEXT NOT NULL, done_at TEXT,
  UNIQUE (deposit_id, op)
);
CREATE INDEX IF NOT EXISTS idx_ge_outbox_open ON ge_outbox(status, next_try_at);

CREATE TABLE IF NOT EXISTS ge_lane (                -- the lane's own daily call count (UTC day), mirrored from the route
  day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, cap INTEGER NOT NULL DEFAULT 400, updated_at TEXT NOT NULL
);
