-- db/work.sql (2026-10-09) The Work Center: who may use it, its settings, batches, the outbox of Blackbaud writes,
-- the event log, Support's entry rows and the daily call meter.

CREATE TABLE IF NOT EXISTS act_staff (            -- the people the Work Center knows; edited on an admin page
  email TEXT PRIMARY KEY,                          -- lower case, @favorintl.org
  name TEXT NOT NULL,
  team TEXT NOT NULL,                              -- support | rdd | partner_care | church | grants | admin | exec
  bb_fundraiser_id TEXT,                           -- Blackbaud constituent id used in the fundraisers array; null when none
  work_center INTEGER NOT NULL DEFAULT 0,          -- 1 = may open the Work Center once it is released
  entry_owner INTEGER NOT NULL DEFAULT 0,          -- 1 = has an Entry chip (the RDDs and the executive owners)
  entry_type TEXT,                                 -- RDD Action | CED Action | Carole Action | Terry Action
  sheet_tab TEXT,                                  -- tracking sheet tab prefix, e.g. "Brian's"
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
-- keys: release ('admins' | 'support'), posting ('on' | 'off', the kill switch), lane_cap ('2400'),
--       meter:<utc date> (last calls_today the upkeep route reported), rule:tags, ops_url, lock:<batch id>

CREATE TABLE IF NOT EXISTS act_batches (
  id TEXT PRIMARY KEY,                             -- newId('wcb')
  op TEXT NOT NULL,                                -- complete | thank | close_thanked | reassign | reschedule | create | undo
  undo_of TEXT,                                    -- batch id this one undoes
  actor TEXT NOT NULL, actor_email TEXT NOT NULL,
  params TEXT NOT NULL,                            -- JSON: date, line, outcome, how, mode, from, to, due, owner
  n INTEGER NOT NULL, calls_planned INTEGER NOT NULL,
  calls_used INTEGER NOT NULL DEFAULT 0,
  run_when TEXT NOT NULL DEFAULT 'now',            -- now | tonight
  state TEXT NOT NULL DEFAULT 'queued',            -- queued | running | done | partial | undone
  undo_until TEXT NOT NULL,                        -- created_at + 24 hours
  req_id TEXT,                                     -- one per button press, so a double click returns the first batch
  created_at TEXT NOT NULL, finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_act_batches_req ON act_batches(req_id) WHERE req_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_act_batches_created ON act_batches(created_at);

CREATE TABLE IF NOT EXISTS act_outbox (            -- one Blackbaud change per row
  id TEXT PRIMARY KEY,                             -- newId('wco')
  batch_id TEXT NOT NULL,
  action_id TEXT,                                  -- Blackbaud action id; null for a create until it posts
  cid TEXT,                                        -- the partner's system id, for the pending overlay and Recent
  label TEXT,                                      -- 'Partner name | summary', so Recent needs no mirror read
  submission_id TEXT,                              -- act_submissions row for a create
  op TEXT NOT NULL,                                -- patch | create | tag | delete
  before TEXT,                                     -- JSON of the fields this change replaces (from the mirror or the read-back), for Undo
  payload TEXT NOT NULL,                           -- JSON body sent to Blackbaud
  idem_key TEXT UNIQUE,                            -- creates: hash of what makes the create the same one; cleared when the row is undone so it can be entered again
  state TEXT NOT NULL DEFAULT 'queued',            -- queued | sent | verified | failed | needs_human | undone
  attempts INTEGER NOT NULL DEFAULT 0,
  bb_id TEXT, last_error TEXT,
  queued_at TEXT NOT NULL, sent_at TEXT, verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_outbox_batch ON act_outbox(batch_id);
CREATE INDEX IF NOT EXISTS idx_act_outbox_action ON act_outbox(action_id, state);
CREATE INDEX IF NOT EXISTS idx_act_outbox_state ON act_outbox(state, queued_at);

CREATE TABLE IF NOT EXISTS act_events (            -- every change and every Blackbaud call, with the person
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, actor_email TEXT NOT NULL,
  batch_id TEXT, action_id TEXT, kind TEXT NOT NULL,     -- batch_created | call | verified | failed | undone | reopened_in_blackbaud | release_changed
  method TEXT, path TEXT, ok INTEGER, status INTEGER, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_events_at ON act_events(at);
CREATE INDEX IF NOT EXISTS idx_act_events_action ON act_events(action_id);

CREATE TABLE IF NOT EXISTS act_submissions (       -- Entry rows: pasted from the sheet, read from the sheet, or typed
  id TEXT PRIMARY KEY,                             -- newId('wcs')
  owner_fid TEXT NOT NULL,                         -- the RDD or owner whose contact it is
  source TEXT NOT NULL,                            -- sheet | paste | many | typed | rdd (RDD submits on the hub, later)
  sheet_ref TEXT,                                  -- "<tab>!<row>" for de-duplication of re-reads
  contact_date TEXT NOT NULL,                      -- YYYY-MM-DD
  raw TEXT NOT NULL,                               -- JSON of the sheet row as read
  constituent_id TEXT, match_how TEXT,             -- email | phone | name | name_portfolio | picked
  channel TEXT,                                    -- call | vm | text | email | meet | mail
  summary TEXT, description TEXT, tags TEXT,       -- tags JSON array of field keys
  ask_amount REAL, referrals INTEGER,
  state TEXT NOT NULL DEFAULT 'waiting',           -- waiting | in_blackbaud | posting | posted | skipped | failed
  dup_action_id TEXT,                              -- the Blackbaud action the duplicate guard found
  bb_action_id TEXT, posted_at TEXT, posted_by TEXT,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_sub_owner ON act_submissions(owner_fid, contact_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_act_sub_sheet ON act_submissions(sheet_ref) WHERE sheet_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS act_meter (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, route_calls INTEGER, updated_at TEXT NOT NULL);
-- day = UTC date (the upkeep route counts per UTC day); calls = the Work Center's own; route_calls = calls_today the route last reported

-- 2026-10-10: full editing. Saved views per person, repeating follow-ups, a short copy of an action's notes, tags and attachments,
-- and the hub's own copy of an opportunity it changed until the mirror catches up.
CREATE TABLE IF NOT EXISTS act_views (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
  spec TEXT NOT NULL,                              -- JSON: tab, filters, sort, columns
  is_default INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_views_email ON act_views(email);

CREATE TABLE IF NOT EXISTS act_recur (             -- a follow-up that repeats: completing action_id makes the next one
  action_id TEXT PRIMARY KEY, cid TEXT NOT NULL,
  rule TEXT NOT NULL,                              -- JSON { every, unit: day|week|month, until, left }
  template TEXT NOT NULL,                          -- JSON of the fields each new one copies
  active INTEGER NOT NULL DEFAULT 1, made_by TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS act_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);   -- notes:<id>, tags:<id>, attachments:<id>, kept ten minutes

CREATE TABLE IF NOT EXISTS act_opps (id TEXT PRIMARY KEY, cid TEXT NOT NULL, raw TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_act_opps_cid ON act_opps(cid);
