-- db/comm-picture.sql (2026-10-13) Partners who replied STOP to a text. The Cadence text step is switched off for them. Hub only:
-- the hub has no writer for Blackbaud solicit codes, so nothing here reaches Blackbaud.
CREATE TABLE IF NOT EXISTS cad_no_text (
  cid TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'Replied STOP',
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);
