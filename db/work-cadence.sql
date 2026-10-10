-- Partner Care cadence (Work Center, round 3 group D). One row per step pressed on the Cadence tab, so the row clears at once, before
-- the Blackbaud copy has read the new action back. outcome is 'done' or 'left' (a call that reached voicemail: the step stays due).
CREATE TABLE IF NOT EXISTS act_cadence_done (
  id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  step TEXT NOT NULL,            -- call | text | email | card
  outcome TEXT NOT NULL,         -- done | left
  owner_fid TEXT,
  rule TEXT,
  line TEXT,
  batch_id TEXT,
  remind_on TEXT,
  actor TEXT,
  actor_email TEXT,
  done_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_cadence_cid ON act_cadence_done(cid, done_at);
CREATE INDEX IF NOT EXISTS idx_act_cadence_at ON act_cadence_done(done_at);
CREATE INDEX IF NOT EXISTS idx_act_cadence_batch ON act_cadence_done(batch_id);
