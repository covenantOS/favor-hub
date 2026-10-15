-- Evaluations, 2026-10-15: decline notes, the review meeting, and the length of the two weeks. Additive only.
-- Apply once to favor-requests (ALTER TABLE ADD COLUMN is not repeatable). The code runs before and after it.
ALTER TABLE eval_reviewers ADD COLUMN decline_note TEXT NOT NULL DEFAULT '';
ALTER TABLE eval_cases ADD COLUMN leader_email TEXT;
ALTER TABLE eval_cases ADD COLUMN meeting_time TEXT;
ALTER TABLE eval_cases ADD COLUMN meeting_link TEXT;
ALTER TABLE eval_terms ADD COLUMN w1_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE eval_terms ADD COLUMN w2_days INTEGER NOT NULL DEFAULT 7;
