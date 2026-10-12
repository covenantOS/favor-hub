-- Request board email notices (2026-10-11). Additive only: two new tables. Apply with
--   wrangler d1 execute favor-requests --remote --file db/request-email.sql
-- Email follows the same gate as every request notice (hub_settings requests.notify and requests.notify.only) and its own
-- switch (requests.email). Nothing is sent for a notice written before this file is applied or while the gate was closed.

-- How each person wants request email: now (one email per event), daily (one summary each weekday morning) or off.
-- No row means now.
CREATE TABLE IF NOT EXISTS request_email_prefs (
  email TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'now',         -- now | daily | off
  updated_at TEXT NOT NULL
);

-- One row per notice that has been emailed or put in a summary, taken before the send, so no notice is ever emailed twice.
CREATE TABLE IF NOT EXISTS request_email_log (
  notice_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  mode TEXT NOT NULL,                       -- now | daily
  state TEXT NOT NULL DEFAULT 'sending',    -- sending | sent | failed | skipped
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_email_log_email ON request_email_log(email, at);
