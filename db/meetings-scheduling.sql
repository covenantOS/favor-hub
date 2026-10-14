-- db/meetings-scheduling.sql (2026-10-14) Meetings scheduling: repeating series, templates, booking pages, working hours, holds.
-- Run once on the favor-requests D1. Additive only: new tables and new columns with defaults.

-- One row per repeating series. id is the series_id every occurrence carries (the first meeting's id for series made before this).
CREATE TABLE IF NOT EXISTS hub_meeting_series (
  id TEXT PRIMARY KEY,
  host_email TEXT NOT NULL,
  host_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  agenda TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL DEFAULT 60,
  rec_mode TEXT NOT NULL DEFAULT 'video',
  access TEXT NOT NULL DEFAULT 'invited',
  invitees TEXT NOT NULL DEFAULT '[]',
  remind INTEGER NOT NULL DEFAULT 1,
  post_channel TEXT NOT NULL DEFAULT '',
  rule TEXT NOT NULL,                     -- JSON, see functions/_lib/meetrecur.ts
  tz TEXT NOT NULL DEFAULT 'America/New_York',
  dtstart TEXT NOT NULL,                  -- ISO UTC of the first occurrence
  exdates TEXT NOT NULL DEFAULT '[]',     -- JSON ISO original starts that were cancelled one at a time
  calendar_event_id TEXT NOT NULL DEFAULT '',
  calendar_owner TEXT NOT NULL DEFAULT '', -- whose Google Calendar holds the series event
  template_id TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  drive_folder TEXT NOT NULL DEFAULT '',
  carry_actions INTEGER NOT NULL DEFAULT 1, -- open action items from the last meeting go on the next agenda
  parent_id TEXT NOT NULL DEFAULT '',     -- the series this one was split from ("this and following")
  status TEXT NOT NULL DEFAULT 'active',  -- active | ended | cancelled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_series_host ON hub_meeting_series(host_email);

ALTER TABLE hub_meetings ADD COLUMN orig_start TEXT NOT NULL DEFAULT '';   -- the occurrence's start before any one-off move (Google's instance id)
ALTER TABLE hub_meetings ADD COLUMN detached INTEGER NOT NULL DEFAULT 0;    -- 1 once moved or changed alone ("this one")
ALTER TABLE hub_meetings ADD COLUMN carried INTEGER NOT NULL DEFAULT 0;     -- 1 once the last meeting's open action items were added to the agenda
ALTER TABLE hub_meetings ADD COLUMN tz TEXT NOT NULL DEFAULT '';            -- the time zone the host booked in, for display
UPDATE hub_meetings SET orig_start = starts_at WHERE series_id != '' AND orig_start = '' AND starts_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_meetings_series ON hub_meetings(series_id, orig_start);

-- Recurring team meetings from a template: the agenda, recording, invitees, team and Drive notes folder in one pick.
CREATE TABLE IF NOT EXISTS hub_meeting_templates (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  agenda TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL DEFAULT 60,
  rec_mode TEXT NOT NULL DEFAULT 'video',
  access TEXT NOT NULL DEFAULT 'invited',
  invitees TEXT NOT NULL DEFAULT '[]',
  team TEXT NOT NULL DEFAULT '',
  drive_folder TEXT NOT NULL DEFAULT '',
  rule TEXT NOT NULL DEFAULT '',
  shared INTEGER NOT NULL DEFAULT 0,      -- 1: everyone on staff sees it in their template list
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_templates_owner ON hub_meeting_templates(owner_email);

-- Working hours, time zone, buffer and travel time per person, for suggested times and booking pages.
CREATE TABLE IF NOT EXISTS hub_sched_prefs (
  email TEXT PRIMARY KEY,
  tz TEXT NOT NULL DEFAULT 'America/New_York',
  day_start INTEGER NOT NULL DEFAULT 540,  -- minutes after midnight
  day_end INTEGER NOT NULL DEFAULT 1020,
  work_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  buffer_min INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Booking pages: a person's meeting types. The public page is /meet/with/?u=<handle>, one type is &t=<slug>.
CREATE TABLE IF NOT EXISTS hub_booking_types (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL,                   -- the owner's page name, same on every type they own
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL DEFAULT 30,
  audience TEXT NOT NULL DEFAULT 'partners', -- partners (anyone with the link) | staff (signed-in staff only)
  avail TEXT NOT NULL DEFAULT '{}',       -- JSON {days:{"1":[[540,1020]],...}}; empty uses the owner's working hours
  tz TEXT NOT NULL DEFAULT 'America/New_York',
  buffer_min INTEGER NOT NULL DEFAULT 10,
  travel_min INTEGER NOT NULL DEFAULT 0,  -- in-person visits: blocked before and after
  notice_min INTEGER NOT NULL DEFAULT 240, -- earliest booking from now
  horizon_days INTEGER NOT NULL DEFAULT 30,
  max_per_day INTEGER NOT NULL DEFAULT 4,
  step_min INTEGER NOT NULL DEFAULT 30,
  questions TEXT NOT NULL DEFAULT '[]',   -- JSON [{q, required}]
  location TEXT NOT NULL DEFAULT 'video', -- video | phone | in_person
  place TEXT NOT NULL DEFAULT '',
  rec_mode TEXT NOT NULL DEFAULT 'off',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_booking_types_slug ON hub_booking_types(handle, slug);
CREATE INDEX IF NOT EXISTS idx_hub_booking_types_owner ON hub_booking_types(owner_email);

CREATE TABLE IF NOT EXISTS hub_bookings (
  id TEXT PRIMARY KEY,
  type_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  answers TEXT NOT NULL DEFAULT '[]',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'America/New_York',
  status TEXT NOT NULL DEFAULT 'booked',  -- booked | cancelled | moved
  manage_hash TEXT NOT NULL,              -- sha256 of the key in the partner's manage link; the key itself is never stored
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_bookings_owner ON hub_bookings(owner_email, starts_at);
CREATE INDEX IF NOT EXISTS idx_hub_bookings_ip ON hub_bookings(ip, created_at);

-- Tentative holds the scheduling assistant put on the booker's Google Calendar; booking one time releases the rest.
CREATE TABLE IF NOT EXISTS hub_meeting_holds (
  id TEXT PRIMARY KEY,
  grp TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  calendar_event_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'held',    -- held | released | booked
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_meeting_holds_grp ON hub_meeting_holds(grp);
