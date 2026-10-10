-- Favor Brain page settings kept per person (2026-10-10). Today the only key is "connect_seen": the connect
-- popup shows once, and this row says it has. Run before the first deploy that reads it.
CREATE TABLE IF NOT EXISTS brain_prefs (
  email TEXT NOT NULL,
  key TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (email, key)
);
