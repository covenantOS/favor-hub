-- Notifications (2026-10-14): feedback reply emails, task tag emails and nudges. Additive.
-- Apply with: wrangler d1 execute favor-requests --remote --file db/notify.sql

-- The last time a person opened a task in FavorOS (signed in, not an agent key). Opening a task stops its nudges, and a person with
-- no row here has never opened Projects, so the first tag email reaches them whatever their email choice says.
CREATE TABLE IF NOT EXISTS hub_task_seen (
  email TEXT NOT NULL,
  task_id TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (email, task_id)
);

-- One row per person tagged on a task (mentioned, assigned, or added as a follower by someone else). The weekday morning pass sends
-- "Did you see this?" after 1 business day (n1_at) and again after 3 (n2_at), then tells the tagger once (told_at) and stops.
-- done_at closes the row: seen (opened), replied (commented), closed (task done or dropped), told (tagger told), off (email off).
CREATE TABLE IF NOT EXISTS hub_task_nudges (
  email TEXT NOT NULL,
  task_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tagged_at TEXT NOT NULL,
  n1_at TEXT,
  n2_at TEXT,
  told_at TEXT,
  done_at TEXT,
  done_why TEXT,
  PRIMARY KEY (email, task_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_task_nudges_open ON hub_task_nudges(done_at, tagged_at);
