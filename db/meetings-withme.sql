-- Meetings: people sharing one device ("Someone's with me", 2026-10-14). A person added on someone else's device gets a presence
-- row of their own, tied to that device's pid by with_pid, so they count as present. Their heartbeat is the device's.
ALTER TABLE hub_meeting_presence ADD COLUMN with_pid TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_hub_meeting_presence_with ON hub_meeting_presence(meeting_id, with_pid);
