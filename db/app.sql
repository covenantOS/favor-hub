-- The new hub frame (2026-10-08).
--   hub_users.kpi     1 = sees the KPI dashboard and the year's numbers in the hub. Will said on
--                     2026-10-08 he does not want everybody seeing the KPI dashboard and would like it
--                     scoped to each person's position; until he sets that, leadership only.
--   request_routes    every "Make a request": what the person typed, where the hub suggested it go,
--                     and where they sent it (Will's board, the Marketing team's Asana form, or an
--                     expense request).

ALTER TABLE hub_users ADD COLUMN kpi INTEGER NOT NULL DEFAULT 0;

INSERT INTO hub_users (email, name, role, blocked, note, kpi, created_at, updated_at)
VALUES
  ('will@favorintl.org', 'Will Hamilton', 'admin', 0, '', 1, '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z'),
  ('carole@favorintl.org', 'Carole Ward', 'staff', 0, 'Founder', 1, '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z'),
  ('terry@favorintl.org', 'Terry Goodman', 'staff', 0, 'Uganda/SS Director', 1, '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z'),
  ('rachel@favorintl.org', 'Rachel Cox', 'staff', 0, 'Director of Operations & Administrative', 1, '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z'),
  ('michael@favorintl.org', 'Michael Hinton', 'staff', 0, 'Deputy Director of Operations & Administrative', 1, '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z')
ON CONFLICT(email) DO UPDATE SET kpi = 1, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS request_routes (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  suggested TEXT NOT NULL,               -- board | marketing | expense
  how TEXT NOT NULL DEFAULT '',          -- ai | words | default
  chosen TEXT,                           -- where the person sent it
  chosen_at TEXT,
  request_id TEXT                        -- the board card, when it went to the board
);

CREATE INDEX IF NOT EXISTS idx_request_routes_at ON request_routes(at);
