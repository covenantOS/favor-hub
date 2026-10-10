-- db/work-gifts.sql (2026-10-10) Gifts to thank: one row per thank-you a person made on a gift in the Work Center, so the list clears at
-- once, before the mirror has read the new Blackbaud action back. A row whose batch was undone does not count.
CREATE TABLE IF NOT EXISTS act_thanks (
  id TEXT PRIMARY KEY,                             -- newId('wct')
  gift_id TEXT NOT NULL,                           -- the Blackbaud gift
  cid TEXT NOT NULL,                               -- the partner thanked (the giver, or the partner a soft credit counts for)
  owner_fid TEXT,                                  -- the director whose list it was
  how TEXT NOT NULL,                               -- call | text | email | letter | card | visit
  outcome TEXT NOT NULL,                           -- talked | sent | left (left = a message was left, the gift stays owed)
  batch_id TEXT NOT NULL,                          -- act_batches.id that wrote it to Blackbaud
  task_ids TEXT,                                   -- JSON: open thank-you tasks closed by this thank-you
  line TEXT,
  remind_on TEXT,                                  -- YYYY-MM-DD; set when a message was left, read by the reminders
  follow_up TEXT,                                  -- YYYY-MM-DD of the follow-up task, when one was made
  actor TEXT NOT NULL, actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_thanks_gift ON act_thanks(gift_id, cid);
CREATE INDEX IF NOT EXISTS idx_act_thanks_at ON act_thanks(created_at);
CREATE INDEX IF NOT EXISTS idx_act_thanks_batch ON act_thanks(batch_id);
