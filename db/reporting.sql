-- My dashboard (2026-10-12): answers a person pinned from Favor Brain. One row per pin, private to its owner. The answer is
-- the Brain's blocks as the Brain page drew them (a table keeps its preview rows), so a pin opens at once and Refresh asks
-- the same question again. Additive; run before the first deploy that reads it.
CREATE TABLE IF NOT EXISTS report_pins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  asked_at TEXT NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_pins_email ON report_pins(email, pos);
