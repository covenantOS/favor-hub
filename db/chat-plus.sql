-- Favor Chat additions, 2026-10-14: scheduled messages and reminders, checklists made of Projects tasks, polls, and a status line.

-- A message written now and posted later (kind send), or a reminder posted into a conversation (kind remind).
CREATE TABLE IF NOT EXISTS chat_scheduled (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,                       -- the writer; the message posts as this person
  channel_id TEXT NOT NULL,
  thread_id INTEGER,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'send',         -- send | remind
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',    -- waiting | sending | sent | canceled | failed
  note_id INTEGER,                           -- the writer's private confirmation message
  message_id INTEGER,                        -- the message it became
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_scheduled_due ON chat_scheduled(status, send_at);
CREATE INDEX IF NOT EXISTS idx_chat_scheduled_email ON chat_scheduled(email, status);

-- A checklist message: each line is a Projects task, so done in Chat is done in Projects and the other way.
CREATE TABLE IF NOT EXISTS chat_checklist_items (
  message_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_checklist_task ON chat_checklist_items(task_id);

CREATE TABLE IF NOT EXISTS chat_poll_votes (
  message_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  choice INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, email, choice)
);

-- "In Uganda until Friday", "Out of office": shown beside the name in Chat until it runs out.
CREATE TABLE IF NOT EXISTS chat_status (
  email TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  away INTEGER NOT NULL DEFAULT 0,           -- 1 = out of office: a direct message to this person gets an automatic note back
  until TEXT,
  updated_at TEXT NOT NULL
);
