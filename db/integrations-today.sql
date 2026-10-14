-- db/integrations-today.sql (2026-10-14) Cross-app work in FavorOS: hand-offs, the Today inbox and Waiting on lists, nudges, and partner
-- mentions added to the contact log. Safe to run more than once.

-- "Hand this to <person>" on a mail thread, a task, a request or a partner. One row per hand-off.
CREATE TABLE IF NOT EXISTS hub_handoffs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- mail | task | request | partner
  ref_id TEXT NOT NULL,               -- thread id, task id, request id or partner (constituent) id
  title TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '',      -- where the receiver opens it
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL,
  to_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',   -- the text that travels with it (the email, the task description)
  channel TEXT NOT NULL DEFAULT '',   -- chat | email | none: how the receiver was told
  moved TEXT NOT NULL DEFAULT '',     -- what changed at the source (owner set, request sent on, mail assigned)
  created_at TEXT NOT NULL,
  picked_at TEXT,                     -- the receiver opened it or pressed Got it
  told_at TEXT,                       -- the giver was told it was picked up
  seen_at TEXT                        -- the giver cleared the "picked up" line from their inbox
);
CREATE INDEX IF NOT EXISTS idx_hub_handoffs_to ON hub_handoffs(to_email, picked_at);
CREATE INDEX IF NOT EXISTS idx_hub_handoffs_from ON hub_handoffs(from_email, created_at);

-- Items a person cleared from Today that have no read state of their own (a Waiting on line they stopped waiting on).
CREATE TABLE IF NOT EXISTS hub_today_cleared (
  email TEXT NOT NULL,
  item TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (email, item)
);

-- Every Nudge pressed on a Waiting on line: who, which line, which channel. Shows "Nudged today" and stops a second nudge the same day.
CREATE TABLE IF NOT EXISTS hub_nudges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  item TEXT NOT NULL,
  to_email TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',   -- chat | email | task | request | mail
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_nudges_item ON hub_nudges(email, item, at);

-- A partner mention (chat, task, request, meeting notes, email) a person added to the contact log from the partner page.
-- The action itself goes through the Work Center's Blackbaud queue; this row only marks the mention as logged.
CREATE TABLE IF NOT EXISTS hub_mention_logs (
  cid TEXT NOT NULL,
  source TEXT NOT NULL,               -- the timeline event id, such as chat:123 or task:t_abc
  by_email TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (cid, source)
);
