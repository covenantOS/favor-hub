-- Favor Brain chat history (2026-10-09), in favor-requests. The Brain writes one turn after each answer
-- (favor-mcp src/chat-store.ts through its AUDIT binding, the same database as the hub's DB); the hub's
-- Brain page lists, opens, renames, pins and deletes chats. A chat is deleted 30 days after its last
-- turn (the history route does it). The table rows behind a list are not stored: the preview stays, and a
-- list older than 24 hours says "Expired. Ask again." Run before the first deploy that reads them.
CREATE TABLE IF NOT EXISTS brain_threads (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  made_at TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'person'
);
CREATE INDEX IF NOT EXISTS idx_brain_threads_email ON brain_threads(email, changed_at);
CREATE INDEX IF NOT EXISTS idx_brain_threads_changed ON brain_threads(changed_at);
CREATE TABLE IF NOT EXISTS brain_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  at TEXT NOT NULL,
  ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_brain_turns_thread ON brain_turns(thread_id, n);
CREATE INDEX IF NOT EXISTS idx_brain_turns_ref ON brain_turns(ref);
