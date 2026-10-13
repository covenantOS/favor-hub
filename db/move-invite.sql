-- Move to FavorOS email log. One row per meeting and person, so a meeting never emails the same person twice.
CREATE TABLE IF NOT EXISTS hub_meeting_invite_log (
  meeting_id TEXT NOT NULL,
  email TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'sent',
  PRIMARY KEY (meeting_id, email)
);
