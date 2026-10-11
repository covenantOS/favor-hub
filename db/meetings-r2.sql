-- Meetings round 2: the Google Doc made from the notes sits next to the recording in Drive.
ALTER TABLE hub_meetings ADD COLUMN notes_doc_id TEXT NOT NULL DEFAULT '';
