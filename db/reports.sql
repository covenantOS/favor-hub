-- Reports area (functions/_lib/reports). Apply once with:
--   wrangler d1 execute favor-requests --remote --file db/reports.sql
-- Scheduled email delivery is not built. Today a person posts the Daily Revenue Report by hand.

-- Who uses which reports, by audience (admin_desk, operations, leadership, support, partner_care, rdd, grants, marketing).
-- Admins see every report without a row here. Rows are added in the database, never in the repository.
CREATE TABLE IF NOT EXISTS rpt_people (
  email TEXT NOT NULL,
  audience TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (email, audience)
);

-- Typed-in values a report cannot read from Blackbaud: Africa income by month (QuickBooks), mailed quantity per appeal.
CREATE TABLE IF NOT EXISTS rpt_edits (
  report_id TEXT NOT NULL,
  row_key TEXT NOT NULL,
  col TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (report_id, row_key, col)
);

-- One line per run, for knowing which reports people open. No rows and no figures are stored.
CREATE TABLE IF NOT EXISTS rpt_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  email TEXT NOT NULL,
  format TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  ran_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rpt_runs_report ON rpt_runs (report_id, ran_at);
