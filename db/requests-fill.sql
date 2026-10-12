-- Requests that fill themselves out (2026-10-12). Additive only: one new column on request_routes.
-- Apply with: wrangler d1 execute favor-requests --remote --file db/requests-fill.sql
-- Run it once; SQLite has no "ADD COLUMN IF NOT EXISTS". Until it runs, the form still fills itself out and the board
-- drawer shows no suggestion, because the suggestion is kept here.

-- The answers the hub suggested for a request: form fields, a suggested owner and a due date (JSON). The request's id lands in
-- request_id once the person sends the form (PUT /api/requests/route).
ALTER TABLE request_routes ADD COLUMN fill TEXT NOT NULL DEFAULT '';
