-- Reporting snapshot (2026-10-12): the last full read of the KPI dashboard and the gift rows behind Highlights, kept so the
-- page opens from one row and refreshes in the background. Additive.
CREATE TABLE IF NOT EXISTS report_snapshots (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  built_at TEXT NOT NULL,
  refreshing_at TEXT
);
