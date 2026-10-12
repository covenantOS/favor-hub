-- Lists, reports and credit (2026-10-12). Additive. Apply once:
--   npx wrangler d1 execute favor-requests --remote --file db/lists-reports.sql
--
-- lr_* tables are a snapshot of the Blackbaud mirror's partner layer (functions/_lib/lists/snapshot.ts), rebuilt a few
-- times a day, so the Lists page counts in milliseconds. Nothing here is the source of record: a table is emptied and
-- refilled whole, inside one D1 batch, so a reader sees the old copy or the new one.

CREATE TABLE IF NOT EXISTS lr_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per household that has given (spouses counted once, soft credits followed).
CREATE TABLE IF NOT EXISTS lr_hh (
  household_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  spouse_record_id TEXT,
  lookup_id TEXT,
  name TEXT,
  ctype TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT,
  alive INTEGER NOT NULL DEFAULT 1,
  first_gift TEXT,
  last_gift TEXT,
  last_amt REAL,
  largest REAL,
  lifetime REAL,
  gifts INTEGER,
  major INTEGER NOT NULL DEFAULT 0,
  last_gift_ly TEXT,
  first_code TEXT,
  first_cat TEXT,
  last_code TEXT,
  last_cat TEXT,
  last_contact TEXT,
  members TEXT,
  no_addr INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lr_hh_last ON lr_hh (last_gift);
CREATE INDEX IF NOT EXISTS lr_hh_state ON lr_hh (state);

CREATE TABLE IF NOT EXISTS lr_holder (
  household_id TEXT NOT NULL,
  fundraiser_id TEXT NOT NULL,
  atype TEXT NOT NULL,
  PRIMARY KEY (household_id, fundraiser_id, atype)
);
CREATE INDEX IF NOT EXISTS lr_holder_fr ON lr_holder (fundraiser_id);

-- Solicit codes (solicit), constituent codes (code), attributes (attr), relationships (rel) and events (event), per household.
CREATE TABLE IF NOT EXISTS lr_tag (
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (household_id, kind, value)
);
CREATE INDEX IF NOT EXISTS lr_tag_kv ON lr_tag (kind, value);

-- One row per gift and credited household. funds, appeals and creds are |id|id| lists so a menu pick is a LIKE.
CREATE TABLE IF NOT EXISTS lr_gift (
  gift_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  gift_date TEXT NOT NULL,
  credited REAL NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL,
  method TEXT,
  funds TEXT,
  fund_names TEXT,
  fund_cats TEXT,
  appeals TEXT,
  appeal_codes TEXT,
  appeal_cats TEXT,
  creds TEXT,
  cred_names TEXT,
  soft INTEGER NOT NULL DEFAULT 0,
  giver TEXT,
  PRIMARY KEY (gift_id, household_id)
);
CREATE INDEX IF NOT EXISTS lr_gift_hh ON lr_gift (household_id, gift_date);
CREATE INDEX IF NOT EXISTS lr_gift_date ON lr_gift (gift_date);

CREATE TABLE IF NOT EXISTS lr_fund (id TEXT PRIMARY KEY, code TEXT, name TEXT, category TEXT, inactive INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS lr_appeal (id TEXT PRIMARY KEY, code TEXT, name TEXT, category TEXT, start TEXT);
CREATE TABLE IF NOT EXISTS lr_fr (id TEXT PRIMARY KEY, name TEXT, ftype TEXT, active INTEGER NOT NULL DEFAULT 1);

-- Saved lists. scope is 'private' (owner only), 'team' (everyone on the named team) or 'all' (every person who can open Lists).
CREATE TABLE IF NOT EXISTS lr_saved (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  spec TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'private',
  team TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lr_saved_owner ON lr_saved (owner);

-- Credit and assignment changes: proposed by the page or by a person, approved by an authorized person, applied through the
-- existing services only while the setting lists.credit_apply is on. Every state change adds a lr_credit_log row.
CREATE TABLE IF NOT EXISTS lr_credit_change (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  gift_id TEXT,
  record_id TEXT,
  household_id TEXT,
  fundraiser_id TEXT,
  assignment_id TEXT,
  change TEXT NOT NULL,
  rule TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'proposed',
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  applied_at TEXT,
  result TEXT
);
CREATE INDEX IF NOT EXISTS lr_credit_state ON lr_credit_change (state, proposed_at);
CREATE INDEX IF NOT EXISTS lr_credit_gift ON lr_credit_change (gift_id);

CREATE TABLE IF NOT EXISTS lr_credit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS lr_credit_log_change ON lr_credit_log (change_id);

-- 2026-10-12 slice 2: one row per fundraiser credit on a gift (distinct gifts), for Credit by fundraiser.
CREATE TABLE IF NOT EXISTS lr_cr (
  gift_id TEXT NOT NULL,
  fundraiser_id TEXT NOT NULL,
  amount REAL NOT NULL,
  gift_amount REAL NOT NULL,
  gift_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (gift_id, fundraiser_id)
);
CREATE INDEX IF NOT EXISTS lr_cr_fr ON lr_cr (fundraiser_id, gift_date);
-- Distinct gifts (one row per gift, whoever it is credited to), for totals that tie to the KPI dashboard.
CREATE TABLE IF NOT EXISTS lr_g1 (
  gift_id TEXT PRIMARY KEY,
  gift_date TEXT NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL,
  funds TEXT,
  fund_names TEXT,
  appeals TEXT,
  appeal_codes TEXT,
  appeal_cats TEXT
);
CREATE INDEX IF NOT EXISTS lr_g1_date ON lr_g1 (gift_date);
