-- db/other-gifts.sql (2026-10-15) Other gifts: DAF grants, foundation transfers, wires, stock and phone gifts (og_ prefix, hub database favor-requests).
-- A person enters each gift into a batch with the soft credit named at entry. A second person approves the batch, and approving posts
-- every gift to Blackbaud through SKY API. The hub keeps its own state here and holds no Blackbaud data other than the ids Blackbaud hands back.
-- No card numbers and no bank numbers are ever stored: the entry has no field for either.

CREATE TABLE IF NOT EXISTS og_batch (
  id TEXT PRIMARY KEY,                             -- newId('ob')
  name TEXT NOT NULL,                              -- 'Other gifts Oct 14'
  status TEXT NOT NULL DEFAULT 'open',             -- open | waiting | posting | posted | needs_person | removed
  created_by TEXT NOT NULL, created_by_email TEXT NOT NULL, created_at TEXT NOT NULL,
  submitted_at TEXT, submitted_by TEXT,
  approved_by TEXT, approved_by_email TEXT, approved_at TEXT,
  posted_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_og_batch_created ON og_batch(created_at);

CREATE TABLE IF NOT EXISTS og_gift (
  id TEXT PRIMARY KEY,                             -- newId('og'); rides in the Blackbaud Reference as 'hub og_...'
  batch_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | posting | check | posted | failed | removed
  kind TEXT NOT NULL,                              -- daf | foundation | wire | stock | phone
  partner_id TEXT, partner_lookup TEXT, partner_name TEXT, partner_place TEXT,
  fund_named TEXT,                                 -- the giving fund named on the notice (DAF) or the grant named (foundation)
  soft_partner_id TEXT, soft_partner_name TEXT,
  no_soft INTEGER NOT NULL DEFAULT 0,              -- the entering person chose "No partner named"
  amount_cents INTEGER,
  gift_date TEXT,                                  -- YYYY-MM-DD
  fund_id TEXT, fund_name TEXT, appeal_id TEXT, appeal_name TEXT,
  ref_text TEXT,                                   -- wire confirmation, or stock ticker and shares
  memo TEXT,
  tribute_kind TEXT,                               -- honor | memorial (db/gift-tributes.sql adds the three tribute columns to a database made before them)
  tribute_name TEXT, tribute_notify TEXT,
  dup_json TEXT,                                   -- why the duplicate guard flagged it, and the decision
  letter_key TEXT, letter_name TEXT, letter_mime TEXT, letter_bytes INTEGER,
  letter_status TEXT,                              -- NULL | pending | done | failed
  letter_error TEXT, bb_file_id TEXT, bb_attachment_id TEXT,
  bb_gift_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT, next_try_at TEXT,
  created_by TEXT NOT NULL, created_by_email TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  posted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_og_gift_batch ON og_gift(batch_id, seq);
CREATE INDEX IF NOT EXISTS idx_og_gift_bb ON og_gift(bb_gift_id);

CREATE TABLE IF NOT EXISTS og_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, batch_id TEXT, gift_id TEXT, kind TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_og_event_batch ON og_event(batch_id, at);
