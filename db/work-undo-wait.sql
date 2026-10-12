-- An Undo pressed while the change is still going to Blackbaud is saved here and applied the moment the send finishes.
CREATE TABLE IF NOT EXISTS act_undo_wait (
  batch_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  requested_at TEXT NOT NULL
);
