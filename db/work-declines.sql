-- Declined payments and zeroed gifts (Work Center tab "Declines"). One row per follow-up logged on a decline, so the row shows its
-- outcome at once, before the Blackbaud copy has read the new action back. status is how the follow-up stands: open, fixed, ended,
-- unreachable or no_action. A call that reached voicemail is outcome 'left' and stays open.
CREATE TABLE IF NOT EXISTS act_declines (
  id TEXT PRIMARY KEY,
  gift_id TEXT NOT NULL,         -- the Blackbaud gift id of the $0 payment or the zeroed gift
  cid TEXT NOT NULL,
  how TEXT NOT NULL,             -- call | text | email | card | note
  outcome TEXT NOT NULL,         -- talked | left | sent
  status TEXT NOT NULL,
  line TEXT,
  remind_on TEXT,
  batch_id TEXT,
  actor TEXT,
  actor_email TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_declines_gift ON act_declines(gift_id, at);
CREATE INDEX IF NOT EXISTS idx_act_declines_at ON act_declines(at);
CREATE INDEX IF NOT EXISTS idx_act_declines_batch ON act_declines(batch_id);
