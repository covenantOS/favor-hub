-- db/gift-tributes.sql (2026-10-15) Honor and memorial gifts, kept in FavorOS. Blackbaud holds no structured tributes for Favor
-- (a Query API run over every gift found none); staff wrote them in the gift comment. Other gifts entry now takes the tribute, and
-- the comment tributes since 2023 are copied in with source 'from comment'. Run once against favor-requests: the ALTERs fail on a second run.
ALTER TABLE og_gift ADD COLUMN tribute_kind TEXT;
ALTER TABLE og_gift ADD COLUMN tribute_name TEXT;
ALTER TABLE og_gift ADD COLUMN tribute_notify TEXT;

CREATE TABLE IF NOT EXISTS fo_gift_tribute (
  id TEXT PRIMARY KEY,                             -- newId('tr')
  bb_gift_id TEXT,                                 -- the Blackbaud gift system id, once the gift is in Blackbaud
  og_gift_id TEXT,                                 -- the Other gifts row that took the tribute at entry
  partner_id TEXT,                                 -- who gave
  kind TEXT NOT NULL,                              -- honor | memorial
  honoree TEXT NOT NULL,
  notify TEXT,                                     -- who to notify, as entered
  source TEXT NOT NULL,                            -- entry | from comment
  comment TEXT,                                    -- the comment a 'from comment' row was read from
  gift_date TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fo_tribute_bb ON fo_gift_tribute(bb_gift_id) WHERE bb_gift_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fo_tribute_og ON fo_gift_tribute(og_gift_id) WHERE og_gift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fo_tribute_partner ON fo_gift_tribute(partner_id);
