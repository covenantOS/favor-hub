-- db/mobile.sql (2026-10-10) The iPhone app's backend: signed-in phones, the writes a phone has sent, and the check photos it uploaded.
-- Every statement is additive. Nothing here touches an existing table.

CREATE TABLE IF NOT EXISTS hub_devices (          -- one row per signed-in phone; the app holds the token, this table its SHA-256
  id TEXT PRIMARY KEY,                             -- newId('dev'), shown in the admin list; never the token
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',                   -- "Staff iPhone", from the app
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  expires_at TEXT NOT NULL,                        -- 90 days after sign-in
  revoked_at TEXT,                                 -- set by Sign out, "sign out all my phones" or an admin
  revoked_by TEXT,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_hub_devices_email ON hub_devices(email);

CREATE TABLE IF NOT EXISTS mobile_writes (        -- the app's offline queue resends safely: a repeat client_id gets the stored answer
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  op TEXT NOT NULL,                                -- contact | done
  state TEXT NOT NULL DEFAULT 'pending',           -- pending | done
  result TEXT,                                     -- JSON answer stored when the write finished
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, client_id)
);

CREATE TABLE IF NOT EXISTS mobile_captures (      -- check and reply-slip photos from the phone, held in the private bucket
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,                              -- check | reply_slip
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  captured_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, client_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_captures_created ON mobile_captures(created_at);
