-- db/meetings-lead.sql (2026-10-10) Who leads each team, for the meeting notes rule.
-- Run once on the favor-requests D1, before the code that reads the column is deployed. db/meetings.sql already has the column for a
-- new database, so on one of those this fails with "duplicate column name" and can be skipped.
--
-- A team's leader can read the notes of any finished meeting that has someone from the team on its roster (the host, a made host or an
-- invited person). Who leads which team is set in D1 by hand, because names and emails stay out of this repository:
--   UPDATE meet_directory SET lead = 1 WHERE lower(email) IN ('<leader email>', ...);
ALTER TABLE meet_directory ADD COLUMN lead INTEGER NOT NULL DEFAULT 0;
