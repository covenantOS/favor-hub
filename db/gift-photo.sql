-- db/gift-photo.sql (2026-10-12) Gift entry from a photo: approve, hold and reject on each row, a second approver above an amount,
-- who may post, and undo within the day. Additive only (ge_ prefix, hub database favor-requests). Apply once with
-- npx wrangler d1 execute favor-requests --remote --file db/gift-photo.sql
-- Posting is OFF for everyone: ge_person is empty until an admin switches a person on. The second approver amount lives in the hub
-- setting ge.second_cents and is unset (off) until an admin saves one.

ALTER TABLE ge_gift ADD COLUMN approved2_by TEXT;          -- the second person, when the amount needs one
ALTER TABLE ge_gift ADD COLUMN approved2_at TEXT;
ALTER TABLE ge_gift ADD COLUMN hold_reason TEXT;           -- set while status = 'held'
ALTER TABLE ge_gift ADD COLUMN hold_by TEXT;
ALTER TABLE ge_gift ADD COLUMN hold_at TEXT;
ALTER TABLE ge_gift ADD COLUMN reject_reason TEXT;         -- a rejected row is status 'removed' with this reason; its photo stays linked
ALTER TABLE ge_gift ADD COLUMN rejected_by TEXT;
ALTER TABLE ge_gift ADD COLUMN rejected_at TEXT;
ALTER TABLE ge_deposit ADD COLUMN undone_at TEXT;          -- the last time the batch was taken back the same day
ALTER TABLE ge_deposit ADD COLUMN undone_by TEXT;
ALTER TABLE ge_deposit ADD COLUMN undone_reason TEXT;

CREATE TABLE IF NOT EXISTS ge_person (
  email TEXT PRIMARY KEY,                          -- lower case
  access INTEGER NOT NULL DEFAULT 0,               -- 1: may open Gift entry without being an admin (admin desk, Partner Care)
  posting INTEGER NOT NULL DEFAULT 0,              -- 1: may send an approved deposit to Blackbaud
  set_by TEXT, set_at TEXT
);
