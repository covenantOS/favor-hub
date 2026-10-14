-- Meetings: sending the link again, by email or text, before or during a meeting (2026-10-14).
-- Every send, one row per person and channel, so the sheet shows "sent 2 min ago" and a repeat inside a minute is skipped.
CREATE TABLE IF NOT EXISTS hub_meeting_sends (
  meeting_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  by_email TEXT NOT NULL,
  to_key TEXT NOT NULL,                   -- the email address, or the phone number for a person with no email on the meeting
  channel TEXT NOT NULL,                  -- email | text
  status TEXT NOT NULL,                   -- sent | failed
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS hub_meeting_sends_m ON hub_meeting_sends (meeting_id, at);
-- Phone numbers for one meeting: a number the host typed for an invitee (email set) or a person added by phone alone (email empty).
CREATE TABLE IF NOT EXISTS hub_meeting_phones (
  meeting_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, phone)
);
-- A staff member's own mobile for meeting texts, set by that person.
CREATE TABLE IF NOT EXISTS hub_user_phones (
  email TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
