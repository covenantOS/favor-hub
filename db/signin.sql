-- Google sign-in for the whole hub. Anyone with a verified @favorintl.org Google account gets in;
-- the codes that each app used to ask for (receipts, foundations, the expense log) stop mattering
-- once HUB_SIGNIN is on.
--   hub_users      everyone who has signed in, plus people added by hand (a role or a block)
--   hub_sessions   one row per signed-in browser; the cookie holds a token, this table its SHA-256
--   hub_auth_log   sign-ins, refusals and sign-outs, for the record

CREATE TABLE IF NOT EXISTS hub_users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',      -- staff | admin
  blocked INTEGER NOT NULL DEFAULT 0,      -- 1 refuses sign-in and ends open sessions
  note TEXT NOT NULL DEFAULT '',
  sign_ins INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_hub_sessions_email ON hub_sessions(email);
CREATE INDEX IF NOT EXISTS idx_hub_sessions_expires ON hub_sessions(expires_at);

CREATE TABLE IF NOT EXISTS hub_auth_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,                      -- signed_in | refused | signed_out
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_hub_auth_log_at ON hub_auth_log(at);

-- Who may open the expense log besides Will and the approvers (comma separated emails).
ALTER TABLE expense_settings ADD COLUMN viewers TEXT NOT NULL DEFAULT '';

-- Starting rows. Will is the hub admin. Stephanie Maier left Favor on 2026-10-08 (Will) and
-- Daniel Casella in August 2026, so neither account may sign in.
INSERT OR IGNORE INTO hub_users (email, name, role, blocked, note, created_at, updated_at)
VALUES ('will@favorintl.org', 'Will Hamilton', 'admin', 0, '', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
INSERT OR IGNORE INTO hub_users (email, name, role, blocked, note, created_at, updated_at)
VALUES ('stephanie@favorintl.org', 'Stephanie Maier', 'staff', 1, 'Left Favor 2026-10-08', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
INSERT OR IGNORE INTO hub_users (email, name, role, blocked, note, created_at, updated_at)
VALUES ('daniel@favorintl.org', 'Daniel Casella', 'staff', 1, 'Left Favor August 2026', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
