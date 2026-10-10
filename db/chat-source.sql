-- Favor Brain chat source (2026-10-10). Chats the agent key or a script session starts are filed 'agent' and
-- hidden from the person's sidebar. Run once against favor-requests (the hub's DB); a second run fails on the ALTER.
ALTER TABLE brain_threads ADD COLUMN source TEXT NOT NULL DEFAULT 'person';
