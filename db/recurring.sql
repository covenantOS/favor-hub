-- Recurring gifts tool. One row per change a person made to a recurring gift schedule from FavorOS, kept with the values before and
-- after so the page shows it at once (before the sync reads it back) and Undo can put it back for 24 hours. op is amount, frequency
-- or status. state: sending (saved before the call), done, failed, lost (no answer from Blackbaud, the change may have landed). An
-- undo is its own row with undo_of set. Payment tokens are never stored here.
CREATE TABLE IF NOT EXISTS act_recurring_changes (
  id TEXT PRIMARY KEY,
  req TEXT,                      -- one per button press, so a double click makes one change
  gift_id TEXT NOT NULL,         -- the Blackbaud id of the recurring gift (the schedule)
  cid TEXT NOT NULL,
  op TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  asked_by TEXT,                 -- how the partner asked: Phone call, Email, Letter, Online, In person
  state TEXT NOT NULL,
  error TEXT,
  undo_of TEXT,
  batch_id TEXT,                 -- the Information Update on the partner's record
  actor TEXT,
  actor_email TEXT,
  at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_act_recurring_req ON act_recurring_changes(req) WHERE req IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_act_recurring_gift ON act_recurring_changes(gift_id, at);
CREATE INDEX IF NOT EXISTS idx_act_recurring_at ON act_recurring_changes(at);
