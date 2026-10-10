-- db/work-hqty.sql (2026-10-10) HQTY letters desk: where each gift of $5,000 and up stands with its letter. A gift with no row here is
-- To write. printed and signed are marks the Support Team presses; mailed carries the batch that logged the HQTY Letter action in
-- Blackbaud (a batch that was undone puts the gift back to signed); cannot carries the reason. Month letter text lives in act_settings
-- under hqty:text:YYYY-MM.
CREATE TABLE IF NOT EXISTS act_hqty (
  gift_id TEXT PRIMARY KEY,                        -- the Blackbaud gift
  cid TEXT NOT NULL,                               -- the partner the letter goes to (soft credit first, else the giver)
  state TEXT NOT NULL,                             -- printed | signed | mailed | cannot
  why TEXT,                                        -- reason, for cannot
  printed_at TEXT, signed_at TEXT, mailed_at TEXT,
  batch_id TEXT,                                   -- act_batches.id that wrote the HQTY Letter action
  by_name TEXT NOT NULL, by_email TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_hqty_state ON act_hqty(state);
CREATE INDEX IF NOT EXISTS idx_act_hqty_batch ON act_hqty(batch_id);

-- Who signs each HQTY letter (2026-10-10, Will's ruling: Terry, Carole, Rachel Cox, Michael Hinton or the partner's RDD). Only a picked
-- signer is stored; with none picked the letter takes the partner's RDD, else the last signer chosen (act_settings hqty:signer:last).
-- A letter's signer is stored again when it is marked mailed, so it keeps the signer it went out with.
CREATE TABLE IF NOT EXISTS act_hqty_signer (
  gift_id TEXT PRIMARY KEY,
  signer TEXT NOT NULL,                            -- terry | carole | rachel | michael | rdd
  by_name TEXT NOT NULL, by_email TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
