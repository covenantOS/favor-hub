-- db/gift-entry-comments.sql (2026-10-11) Review comments on a gift entry row (ge_ prefix, hub database favor-requests).
-- Additive only: one new table, no change to ge_deposit or ge_gift. Append only, like ge_event: no code path edits or deletes a row.
-- A comment never changes an amount, fund, appeal, status or the Blackbaud batch. kind: comment | needs_fix | resolved.

CREATE TABLE IF NOT EXISTS ge_comment (
  id TEXT PRIMARY KEY,                             -- newId('gc')
  gift_id TEXT NOT NULL,                           -- ge_gift.id, the entry the thread belongs to
  deposit_id TEXT NOT NULL,
  author_email TEXT NOT NULL,                      -- lower case
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,                              -- plain text, at most 1,000 characters; empty only for a plain resolved
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'needs_fix', 'resolved')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ge_comment_gift ON ge_comment(gift_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ge_comment_deposit ON ge_comment(deposit_id, kind);
