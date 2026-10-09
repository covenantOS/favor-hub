-- Connect my Google (2026-10-09). One row per person who connected: their refresh token, encrypted
-- with GOOGLE_TOKEN_KEY (AES-GCM), and the read-only scopes they granted. Disconnect deletes the row
-- and revokes the token at Google.
CREATE TABLE IF NOT EXISTS hub_google (
  email TEXT PRIMARY KEY,
  refresh_enc TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  last_used TEXT
);
