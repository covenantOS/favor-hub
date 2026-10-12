-- db/chat-smart.sql (2026-10-12) Chat: each person's language, translations kept per message and language, voice note transcripts.
-- Additive. Run once against favor-requests: npx wrangler d1 execute favor-requests --remote --file db/chat-smart.sql

CREATE TABLE IF NOT EXISTS chat_prefs (
  email TEXT PRIMARY KEY,                -- lower case
  lang TEXT NOT NULL DEFAULT '',         -- the language this person reads Chat in; '' leaves messages as written
  updated_at TEXT NOT NULL
);

-- One row per (message or voice note, language). h is a hash of the text that was translated, so an edited message translates again.
CREATE TABLE IF NOT EXISTS chat_translations (
  ref TEXT NOT NULL,                     -- m:<message id> or v:<voice file id>
  lang TEXT NOT NULL,
  h TEXT NOT NULL,
  src TEXT NOT NULL DEFAULT '',          -- the language the text was written in
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ref, lang)
);

CREATE TABLE IF NOT EXISTS chat_voice (
  file_id TEXT PRIMARY KEY,
  message_id INTEGER,
  status TEXT NOT NULL DEFAULT 'working', -- working | ready | failed
  transcript TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  secs REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_voice_message ON chat_voice(message_id);
