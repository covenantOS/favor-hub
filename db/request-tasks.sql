-- Request board tasks (2026-10-11): an owner for each request, hand-offs with a note, comments with @mentions, followers,
-- a due date, "Waiting on" a person, and the notices that reach Today, the bell and Chat.
-- Additive only: new tables, nothing in an existing table changes. Apply with
--   wrangler d1 execute favor-requests --remote --file db/request-tasks.sql
-- Notices stay off until an admin sets hub_settings requests.notify to on (Admin > Chat).

-- One row per request that has been handed to someone or given a date. A request with no row has no owner.
CREATE TABLE IF NOT EXISTS request_tasks (
  request_id TEXT PRIMARY KEY,
  owner_email TEXT,                         -- who has it now
  sent_by TEXT,                             -- who handed it to them
  sent_at TEXT,
  due_date TEXT,                            -- YYYY-MM-DD, Eastern
  waiting_on TEXT,                          -- the person the work waits on, an email
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_tasks_owner ON request_tasks(owner_email);
CREATE INDEX IF NOT EXISTS idx_request_tasks_sent_by ON request_tasks(sent_by);
CREATE INDEX IF NOT EXISTS idx_request_tasks_waiting ON request_tasks(waiting_on);

-- Everyone who hears about a request: its owner, whoever sent it, anyone mentioned or waited on, and anyone who pressed Follow.
CREATE TABLE IF NOT EXISTS request_followers (
  request_id TEXT NOT NULL,
  email TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT 'follow',       -- owner | sent | mention | waiting | comment | follow
  muted INTEGER NOT NULL DEFAULT 0,         -- 1 after Unfollow: kept so a later mention does not quietly re-add them
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, email)
);
CREATE INDEX IF NOT EXISTS idx_request_followers_email ON request_followers(email);

-- The conversation under a request. A reply typed in Chat under the request's card lands here too (source chat).
CREATE TABLE IF NOT EXISTS request_comments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,                       -- text with <@email> mention tokens, the same tokens Chat uses
  source TEXT NOT NULL DEFAULT 'board',     -- board | chat | send
  chat_message_id INTEGER,                  -- the Chat message it came from, for source chat
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_comments_request ON request_comments(request_id, created_at);

-- What Today and the bell show: one row per person per thing that happened to a request they are part of.
CREATE TABLE IF NOT EXISTS request_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  email TEXT NOT NULL,                      -- who it is for
  kind TEXT NOT NULL,                       -- sent | mention | comment | waiting | done
  actor_email TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  comment_id TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_notices_email ON request_notices(email, read_at);
CREATE INDEX IF NOT EXISTS idx_request_notices_request ON request_notices(request_id);

-- Chat messages that belong to a request: the card sent in a direct message, and each comment copied under that card.
-- A reply in a card's thread finds its request here.
CREATE TABLE IF NOT EXISTS request_chat_links (
  message_id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  root_id INTEGER,                          -- the card message for a copied comment; null for the card itself
  comment_id TEXT,
  kind TEXT NOT NULL,                       -- card | copy | reply
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_chat_links_request ON request_chat_links(request_id, kind);
