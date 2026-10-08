-- Foundation prospects. Replaces logging cold foundation outreach on the
-- "Unsolicited Foundations" record in Blackbaud. A prospect lives here until
-- it earns a Blackbaud record; every contact still posts to Blackbaud as an
-- action (RDD Action for an RDD, Grants Action for a grant writer) so the
-- fundraiser's activity is counted there.

CREATE TABLE IF NOT EXISTS fnd_foundations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  ein TEXT NOT NULL DEFAULT '',
  assets TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',          -- open | dead
  dead_reason TEXT NOT NULL DEFAULT '',
  bb_lookup_id TEXT,                            -- the foundation's own Blackbaud record, once it has one
  bb_system_id TEXT,
  bb_name TEXT,
  bb_match_reason TEXT,
  bb_linked_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fnd_foundations_key ON fnd_foundations(name_key);
CREATE INDEX IF NOT EXISTS idx_fnd_foundations_bb ON fnd_foundations(bb_lookup_id);

CREATE TABLE IF NOT EXISTS fnd_contacts (
  id TEXT PRIMARY KEY,
  foundation_id TEXT NOT NULL,
  contact_date TEXT NOT NULL,                   -- YYYY-MM-DD
  how TEXT NOT NULL,                            -- Call | Voicemail | Text | Email | Meeting | Mailing | Other
  category TEXT NOT NULL,                       -- Blackbaud action category
  rdd_name TEXT NOT NULL DEFAULT '',            -- whose contact it is, an RDD or a grant writer
  rdd_id TEXT NOT NULL DEFAULT '',              -- Blackbaud system id of the fundraiser
  summary TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',              -- JSON array of tag names
  source TEXT NOT NULL DEFAULT 'app',           -- app | import
  bb_action_id TEXT,                            -- Blackbaud action id once posted
  bb_on TEXT,                                   -- lookup id of the record the action sits on
  bb_state TEXT NOT NULL DEFAULT 'pending',     -- posted | pending | failed | held
  bb_tags_state TEXT NOT NULL DEFAULT 'none',   -- none | posted | waiting
  bb_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (foundation_id) REFERENCES fnd_foundations(id)
);

CREATE INDEX IF NOT EXISTS idx_fnd_contacts_foundation ON fnd_contacts(foundation_id);
CREATE INDEX IF NOT EXISTS idx_fnd_contacts_state ON fnd_contacts(bb_state);
CREATE INDEX IF NOT EXISTS idx_fnd_contacts_action ON fnd_contacts(bb_action_id);

-- Every change made here and every call sent to Blackbaud, in order.
CREATE TABLE IF NOT EXISTS fnd_log (
  id TEXT PRIMARY KEY,
  foundation_id TEXT,
  contact_id TEXT,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  method TEXT,
  path TEXT,
  ok INTEGER,
  status INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fnd_log_created ON fnd_log(created_at);
CREATE INDEX IF NOT EXISTS idx_fnd_log_foundation ON fnd_log(foundation_id);

CREATE TABLE IF NOT EXISTS fnd_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnd_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
