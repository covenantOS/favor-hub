-- People mentioned in a meeting's chat while not in the meeting: the hub bell lists these until they open that meeting.
CREATE TABLE IF NOT EXISTS hub_meeting_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  email TEXT NOT NULL,
  by_name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_mentions_e ON hub_meeting_mentions(email, seen, ts);
