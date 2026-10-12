-- Online gifts review (/online-gifts/): the designation Partner Care approved for each online gift, and the audit trail.
-- gift_key: "re:<gift system id>" for a gift in Blackbaud, "fru:<Fundraise Up donation id>" for an international gift not matched to one.
-- state: approved (nothing to change) | queued (waits for the desktop web view runner) | applied | failed | held (writes off, test
--        limit, tester, or a split gift) | noted (Fundraise Up gift not in Blackbaud yet).
CREATE TABLE IF NOT EXISTS og_review (
  gift_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  gift_id TEXT,
  record_id TEXT,
  amount REAL,
  gift_date TEXT,
  from_fund TEXT,
  read_fund TEXT,
  read_by TEXT,
  chosen_fund TEXT NOT NULL,
  state TEXT NOT NULL,
  result TEXT,
  approved_by TEXT NOT NULL,
  approved_name TEXT,
  approved_at TEXT NOT NULL,
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS og_review_state ON og_review (state, approved_at);
CREATE INDEX IF NOT EXISTS og_review_date ON og_review (gift_date);

CREATE TABLE IF NOT EXISTS og_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_key TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS og_log_key ON og_log (gift_key, id);

-- One reading per gift: the comment fetched from Blackbaud for a gift the mirror holds without one, and the model's answer, so
-- each comment goes to the model at most once.
CREATE TABLE IF NOT EXISTS og_seen (
  gift_key TEXT PRIMARY KEY,
  ref TEXT,
  model_fund TEXT,
  model_state TEXT,
  at TEXT NOT NULL
);
