-- The daily Workers AI budget (functions/_lib/ai/guard.ts). One row a UTC day, one row a day per feature and model.
-- est: the guard's running estimate in neurons. truth: Cloudflare's own total, written by the reconciler every 10 minutes.
-- test_over: units test runs took past the daily cap (drawn from the month's extra test units). off: today's kill flag.
CREATE TABLE IF NOT EXISTS ai_budget_day (
  day TEXT PRIMARY KEY,
  est REAL NOT NULL DEFAULT 0,
  truth REAL NOT NULL DEFAULT 0,
  test_over REAL NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0,
  off INTEGER NOT NULL DEFAULT 0,
  reconciled_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_budget_use (
  day TEXT NOT NULL,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, feature, model)
);
