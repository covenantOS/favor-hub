-- Answers from the Blackbaud copy, kept in the hub database so a Work list opens without waiting on the sync worker.
-- A scheduled job (the favor-work-drain Worker, every 5 minutes through the working day) re-runs the statements people used lately.
CREATE TABLE IF NOT EXISTS mirror_snap (
  h TEXT PRIMARY KEY,
  sql TEXT NOT NULL,
  params TEXT NOT NULL,
  value TEXT NOT NULL,
  at TEXT NOT NULL,
  last_used TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mirror_snap_used ON mirror_snap(last_used);
