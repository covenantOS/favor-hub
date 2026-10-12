-- More than one mailbox in Mail (2026-10-12). Additive only, idempotent. Apply with
--   wrangler d1 execute favor-requests --remote --file db/mail-boxes.sql
-- One row per (person, mailbox the person connected): the refresh token encrypted with GOOGLE_TOKEN_KEY (AES-GCM), the scopes, a
-- name and a marker color. A mailbox is reached only through its owner's own session.
CREATE TABLE IF NOT EXISTS hub_mailboxes (
  owner TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  refresh_enc TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  PRIMARY KEY (owner, mailbox)
);
