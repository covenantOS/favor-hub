-- Favor Chat (2026-10-11). Channels, direct messages, threads, reactions, mentions, unread pointers and shared files.
-- Additive only: new tables, nothing in an existing table changes. Apply with
--   wrangler d1 execute favor-requests --remote --file db/favor-chat.sql
-- Messages live here; the live fan-out (WebSocket) is the favor-chat Worker's ChatRoom Durable Object, which holds no data.

CREATE TABLE IF NOT EXISTS chat_channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                       -- public | private | dm | group
  name TEXT NOT NULL DEFAULT '',            -- empty for dm and group
  topic TEXT NOT NULL DEFAULT '',
  dm_key TEXT,                              -- sorted member emails joined with a comma, dm and group only
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  last_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channels_name ON chat_channels(name) WHERE kind IN ('public', 'private');
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channels_dm ON chat_channels(dm_key) WHERE dm_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_members (
  channel_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',      -- owner | member
  muted INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, email)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_email ON chat_members(email);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  thread_id INTEGER,                        -- the root message's id for a reply, null for a top level message
  email TEXT NOT NULL,                      -- the author, or brain or meetings for the two system voices
  body TEXT NOT NULL DEFAULT '',            -- text with <@email>, <@brain>, <@channel> and <#channel> tokens
  attachments TEXT NOT NULL DEFAULT '[]',   -- JSON: clip {id}, meeting {id}, drive {...}, file {...}, link {...}
  brain TEXT,                               -- JSON {status, blocks, follow} for a Favor Brain answer
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_reply_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, thread_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, id);

CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, email, emoji)
);

CREATE TABLE IF NOT EXISTS chat_reads (
  channel_id TEXT NOT NULL,
  email TEXT NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, email)
);

-- One row per person a message is addressed to: an @mention, a direct message, or a reply in a thread they are in.
-- The rail badge, the bell and Ctrl K read the unread ones.
CREATE TABLE IF NOT EXISTS chat_mentions (
  message_id INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- mention | dm | reply
  created_at TEXT NOT NULL,
  read_at TEXT,
  PRIMARY KEY (message_id, email)
);
CREATE INDEX IF NOT EXISTS idx_chat_mentions_unread ON chat_mentions(email, read_at);

-- A meeting started from a channel: the card's message, and whether the notes have been posted under it.
CREATE TABLE IF NOT EXISTS chat_meetings (
  meeting_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  started_by TEXT NOT NULL DEFAULT '',
  notes_posted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_files (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The two channels every admin joins.
INSERT OR IGNORE INTO chat_channels (id, kind, name, topic, created_by, created_at, last_at) VALUES
  ('ch_general', 'public', 'general', 'Announcements and day-to-day questions for everyone', 'system', '2026-10-11T12:00:00.000Z', '2026-10-11T12:00:00.000Z'),
  ('ch_hub_feedback', 'public', 'hub-feedback', 'Problems and ideas for the hub', 'system', '2026-10-11T12:00:00.000Z', '2026-10-11T12:00:00.000Z');
