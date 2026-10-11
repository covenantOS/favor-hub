-- Admin home and settings center (2026-10-10).
--   hub_settings   one row per setting the admin pages own that did not exist anywhere before. A setting that already lives in
--                  a Pages variable, act_settings or expense_settings keeps living there; a row here overrides a Pages variable
--                  only after an admin saves it, so today's behavior holds until then.
--   hub_audit      every settings change: who, when, the old and the new value.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS hub_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  area TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  before_value TEXT,
  after_value TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_hub_audit_at ON hub_audit(at);

-- Workers AI calls the hub made, one row a day (UTC), for the health strip.
CREATE TABLE IF NOT EXISTS hub_ai_use (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);
