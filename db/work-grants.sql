-- Grants log (Work Center tab "Grants"). One row per submission, LOI, report or task logged from the tab, so it shows at once, before the
-- Blackbaud copy has read the new action back. The action itself, and the file attached to it, live in Blackbaud.
CREATE TABLE IF NOT EXISTS act_grants (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  cid TEXT NOT NULL,             -- the foundation's record
  kind TEXT NOT NULL,            -- request | loi | report | task | cultivation
  state TEXT NOT NULL,           -- sent | todo
  category TEXT NOT NULL,
  on_date TEXT NOT NULL,         -- the date sent, or the due date of a to-do
  summary TEXT NOT NULL,
  file_name TEXT,
  actor TEXT,
  actor_email TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_grants_at ON act_grants(at);
CREATE INDEX IF NOT EXISTS idx_act_grants_batch ON act_grants(batch_id);
