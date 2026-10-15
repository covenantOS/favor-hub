-- Partners directory (2026-10-14). Additive. Apply once:
--   npx wrangler d1 execute favor-requests --remote --file db/partners-directory.sql
--
-- pd_partner is a copy of every Blackbaud record in the mirror (individuals, organizations, churches, foundations, givers or not),
-- one row per record, rebuilt with the lists snapshot (functions/_lib/partners/directory.ts), so the directory searches, filters,
-- sorts and pages in the hub database in milliseconds. It is never the source of record: the table is emptied and refilled inside
-- one D1 batch. The other pd_ tables are FavorOS's own: stars, recently opened, saved views, tags and merge requests.

CREATE TABLE IF NOT EXISTS pd_partner (
  id TEXT PRIMARY KEY,
  lookup TEXT,
  name TEXT NOT NULL,
  sort_name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- individual | organization | church | foundation
  spouse_id TEXT,
  spouse_name TEXT,
  email TEXT,
  phone TEXT,
  addr TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT,
  deceased INTEGER NOT NULL DEFAULT 0,
  inactive INTEGER NOT NULL DEFAULT 0,
  anon INTEGER NOT NULL DEFAULT 0,
  no_email INTEGER NOT NULL DEFAULT 0,
  no_addr INTEGER NOT NULL DEFAULT 0,
  dnm INTEGER NOT NULL DEFAULT 0,
  dne INTEGER NOT NULL DEFAULT 0,
  dnc INTEGER NOT NULL DEFAULT 0,
  added TEXT,
  codes TEXT,                    -- |Partner|Church|
  solicit TEXT,                  -- |Do Not Mail|
  holders TEXT,                  -- |27305|
  holder_names TEXT,
  gifts INTEGER NOT NULL DEFAULT 0,
  lifetime REAL NOT NULL DEFAULT 0,
  first_gift TEXT,
  last_gift TEXT,
  last_amt REAL,
  largest REAL NOT NULL DEFAULT 0,
  ytd REAL NOT NULL DEFAULT 0,
  last_year REAL NOT NULL DEFAULT 0,
  l12 REAL NOT NULL DEFAULT 0,
  hh_last TEXT,                  -- the household's last gift (this record or the spouse), for Active, LYBUNT and Lapsed
  recurring INTEGER NOT NULL DEFAULT 0,
  passed_on REAL NOT NULL DEFAULT 0, -- gifts on this record credited to other partners (a DAF or foundation passing gifts on)
  passed_n INTEGER NOT NULL DEFAULT 0,
  last_contact TEXT,
  open_actions INTEGER NOT NULL DEFAULT 0,
  q TEXT NOT NULL DEFAULT ''     -- lower-case search text: name, lookup id, emails, phone digits, street, city, state, zip
);
CREATE INDEX IF NOT EXISTS pd_partner_sort ON pd_partner (sort_name);
CREATE INDEX IF NOT EXISTS pd_partner_last ON pd_partner (last_gift);
CREATE INDEX IF NOT EXISTS pd_partner_life ON pd_partner (lifetime);
CREATE INDEX IF NOT EXISTS pd_partner_state ON pd_partner (state);
CREATE INDEX IF NOT EXISTS pd_partner_lookup ON pd_partner (lookup);

CREATE TABLE IF NOT EXISTS pd_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Stars: partners a person pinned to the top of their directory.
CREATE TABLE IF NOT EXISTS pd_fav (email TEXT NOT NULL, cid TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (email, cid));
-- Recently opened partner records, per person, on every device. The newest 30 are kept.
CREATE TABLE IF NOT EXISTS pd_recent (email TEXT NOT NULL, cid TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (email, cid));
CREATE INDEX IF NOT EXISTS pd_recent_at ON pd_recent (email, at);
-- Saved views: a directory filter, sort and column set. scope private (owner) or all (everyone who can open the directory).
CREATE TABLE IF NOT EXISTS pd_view (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pd_view_owner ON pd_view (owner);
-- Tags: FavorOS labels on a partner, shared with everyone who can open the directory. They never go to Blackbaud.
CREATE TABLE IF NOT EXISTS pd_tag (cid TEXT NOT NULL, tag TEXT NOT NULL, by_email TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (cid, tag));
CREATE INDEX IF NOT EXISTS pd_tag_tag ON pd_tag (tag);
-- Merge requests: two records someone believes are one partner. Support merges them in Blackbaud's database view and marks the
-- request done here. FavorOS never merges records itself (no API route exists).
CREATE TABLE IF NOT EXISTS pd_merge (
  id TEXT PRIMARY KEY,
  keep_cid TEXT NOT NULL,
  other_cid TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  by_email TEXT NOT NULL,
  by_name TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',  -- open | done | not_same
  done_by TEXT,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS pd_merge_state ON pd_merge (state, at);
