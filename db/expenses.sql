-- Expense requests. Replaces the GHL Pre-Travel and Expense Request doc form.
-- Statuses: pending -> approved | declined

CREATE TABLE IF NOT EXISTS expense_requests (
  id TEXT PRIMARY KEY,
  doc_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  travel_dates TEXT,
  travel_city TEXT,
  reason TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  approver_name TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  requester_signature TEXT NOT NULL,
  approver_signature TEXT,
  review_token_hash TEXT NOT NULL,
  decline_note TEXT,
  requester_ip TEXT,
  approver_ip TEXT,
  pdf_r2_key TEXT,
  submitted_at TEXT NOT NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_requests_status ON expense_requests(status);
CREATE INDEX IF NOT EXISTS idx_expense_requests_created ON expense_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_expense_requests_token ON expense_requests(review_token_hash);

CREATE TABLE IF NOT EXISTS expense_items (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (request_id) REFERENCES expense_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_expense_items_request ON expense_items(request_id);

CREATE TABLE IF NOT EXISTS expense_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES expense_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_expense_events_request ON expense_events(request_id);

-- Yearly counter behind EXP-YYYY-NNNN document numbers.
CREATE TABLE IF NOT EXISTS expense_counters (
  year INTEGER PRIMARY KEY,
  n INTEGER NOT NULL
);

-- Single row: default approver and the on-approval distribution list.
CREATE TABLE IF NOT EXISTS expense_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  approver_name TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  distribution TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Single row: mileage reimbursement rate and the flat per-trip policy deduction
-- (the first N miles of any trip are not reimbursable, per Michael Hinton/HR).
-- Read by the public request form's mileage calculator, editable from the expense log settings.
CREATE TABLE IF NOT EXISTS expense_mileage_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rate_cents INTEGER NOT NULL,
  deduction_miles INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO expense_mileage_settings (id, rate_cents, deduction_miles, updated_at)
VALUES (1, 76, 40, datetime('now'));

-- Date-ranged substitutes (inclusive, America/New_York dates as YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS expense_approver_overrides (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO expense_settings (id, approver_name, approver_email, distribution, updated_at)
VALUES (1, 'Stephanie Maier', 'stephanie@favorintl.org', 'morgan@favorintl.org,hr@favorintl.org,crystal@favorintl.org', datetime('now'));

-- Sessions for the expense log page. Separate from the general hub review
-- password so board reviewers cannot also see expense data.
CREATE TABLE IF NOT EXISTS expense_admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Single row: SHA-256 hash of the expense log admin code. When the row is
-- missing the code falls back to the default (1234) until it is changed
-- from the expense log settings.
CREATE TABLE IF NOT EXISTS expense_admin_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  code_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
