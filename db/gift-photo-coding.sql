-- db/gift-photo-coding.sql (2026-10-12) Appeal coding by evidence. A check carries no appeal code, so a gift with no slip or letter is coded
-- White Mail and goes on the needs-coding list with what is known. Additive only. Apply once with
-- npx wrangler d1 execute favor-requests --remote --file db/gift-photo-coding.sql
ALTER TABLE ge_gift ADD COLUMN needs_coding INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ge_gift ADD COLUMN coding_json TEXT;           -- { source, reason, suggestions: [{ appealId, code, name, source, reason }] }
ALTER TABLE ge_gift ADD COLUMN coded_by TEXT;              -- the person who settled the appeal later
ALTER TABLE ge_gift ADD COLUMN coded_at TEXT;
CREATE INDEX IF NOT EXISTS idx_ge_gift_coding ON ge_gift(needs_coding, status);
