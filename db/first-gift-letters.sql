-- First-gift letters (Gifts > First-gift letters). Thank-you letters to partners whose first gift came from an Acquisition appeal.
-- Replaces the Database View "Donor Acknowledgement Letters" export and Word merge Partner Care ran each month.
-- A batch is one print file: the letters in it, the PDF in R2, and which gifts are marked acknowledged in Blackbaud. Marking happens after
-- printing, as on Receipts, so a print that fails never loses a gift. The gifts reach Blackbaud through the receipts route
-- (functions/_lib/receipts/worker.ts acknowledge). The wording and the default signer sit in rcp_settings (keys fgl:wording).
-- Apply: npx wrangler d1 execute favor-requests --remote --file db/first-gift-letters.sql   (CREATE IF NOT EXISTS only; nothing is dropped.)

CREATE TABLE IF NOT EXISTS fgl_batches (
  id TEXT PRIMARY KEY,
  letter_date TEXT NOT NULL,                    -- YYYY-MM-DD printed on the letters and sent as the acknowledge date
  count INTEGER NOT NULL,                       -- letters, one per partner
  gifts INTEGER NOT NULL DEFAULT 0,             -- gifts the letters cover
  amount REAL NOT NULL DEFAULT 0,
  first_gift TEXT NOT NULL DEFAULT '',
  last_gift TEXT NOT NULL DEFAULT '',
  appeals TEXT NOT NULL DEFAULT '',             -- comma list of the acquisition appeal codes in the file
  signer TEXT NOT NULL DEFAULT '',              -- carole | terry | rachel | michael
  pdf_key TEXT NOT NULL,
  letters TEXT NOT NULL,                        -- JSON, what each page prints
  wording TEXT NOT NULL,                        -- JSON, the wording used
  marked INTEGER NOT NULL DEFAULT 0,
  mark_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'printing',      -- printing | marking | done | cancelled
  simulated INTEGER NOT NULL DEFAULT 0,         -- 1 for the FavorOS test user: nothing is sent to Blackbaud
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  marked_by TEXT NOT NULL DEFAULT '',
  marked_at TEXT,
  downloaded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fgl_batches_created ON fgl_batches(created_at);

CREATE TABLE IF NOT EXISTS fgl_batch_gifts (
  batch_id TEXT NOT NULL,
  gift_id TEXT NOT NULL,                        -- Blackbaud system id
  state TEXT NOT NULL DEFAULT 'waiting',        -- waiting | marked | failed
  detail TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, gift_id)
);

CREATE INDEX IF NOT EXISTS idx_fgl_batch_gifts_gift ON fgl_batch_gifts(gift_id);
