-- Gift images (Work Center tab "Gift images"). What the hub knows about a gift's attachments in Blackbaud: asked (state has or none) or
-- attached by the hub (source hub). The mirror holds no attachments, so this table keeps a gift off the list once it is known to have one.
CREATE TABLE IF NOT EXISTS act_giftimg (
  gift_id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  state TEXT NOT NULL,            -- has | none
  files INTEGER NOT NULL DEFAULT 0,
  file_name TEXT,
  source TEXT NOT NULL,           -- blackbaud (asked) | hub (attached here)
  checked_at TEXT NOT NULL,
  attached_at TEXT,
  actor TEXT,
  actor_email TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_giftimg_state ON act_giftimg(state, checked_at);
