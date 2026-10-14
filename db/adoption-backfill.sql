-- One-time fill of hub_usage from history that existed before page logging (2026-10-14). Days before today only, Eastern (UTC-4),
-- so the live counter never double counts. Areas: signin (hub_auth_log), brain (mcp_audit), tasks (hub_task_events), meet (hub_meeting_presence).
-- INSERT OR IGNORE: running it again changes nothing.
INSERT OR IGNORE INTO hub_usage (email, day, area, n, first_at, last_at)
  SELECT lower(email), date(at, '-4 hours'), 'signin', count(*), min(at), max(at) FROM hub_auth_log
   WHERE event = 'signed_in' AND email <> '' AND date(at, '-4 hours') < '2026-10-14' GROUP BY lower(email), date(at, '-4 hours');
INSERT OR IGNORE INTO hub_usage (email, day, area, n, first_at, last_at)
  SELECT lower(email), date(at, '-4 hours'), 'brain', count(*), min(at), max(at) FROM mcp_audit
   WHERE tool = 'ask' AND email <> '' AND date(at, '-4 hours') < '2026-10-14' GROUP BY lower(email), date(at, '-4 hours');
INSERT OR IGNORE INTO hub_usage (email, day, area, n, first_at, last_at)
  SELECT lower(actor_email), date(created_at, '-4 hours'), 'tasks', count(*), min(created_at), max(created_at) FROM hub_task_events
   WHERE actor_email <> '' AND date(created_at, '-4 hours') < '2026-10-14' GROUP BY lower(actor_email), date(created_at, '-4 hours');
INSERT OR IGNORE INTO hub_usage (email, day, area, n, first_at, last_at)
  SELECT lower(email), date(joined_at / 1000, 'unixepoch', '-4 hours'), 'meet', count(*), datetime(min(joined_at) / 1000, 'unixepoch'), datetime(max(joined_at) / 1000, 'unixepoch') FROM hub_meeting_presence
   WHERE email <> '' AND role <> 'guest' AND date(joined_at / 1000, 'unixepoch', '-4 hours') < '2026-10-14' GROUP BY lower(email), date(joined_at / 1000, 'unixepoch', '-4 hours');
