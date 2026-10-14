-- FavorOS adoption tracker (admin page /admin/adoption). One row per person, Eastern day and area.
--   n         visits that day (one per ten-minute stretch of using that area)
--   first_at  first visit that day, ISO UTC
--   last_at   last recorded visit that day, ISO UTC
-- Filled by functions/_lib/hub/usage.ts from the middleware, never in the request's way. Safe to run twice.
CREATE TABLE IF NOT EXISTS hub_usage (
  email TEXT NOT NULL,
  day TEXT NOT NULL,
  area TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 1,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (email, day, area)
);
CREATE INDEX IF NOT EXISTS idx_hub_usage_day ON hub_usage(day);
