-- Cross-app integrations (2026-10-14): a request becomes a task, a Chat card and focus time; Find a time from any thread; clip replies
-- tied to the thread they answer; meeting prep packs; the optional follow-up email.
-- Additive only: new tables, nothing in an existing table changes. Apply with
--   wrangler d1 execute favor-requests --remote --file db/integrations.sql

-- Focus time held on the owner's own calendar for an accepted request. One row per hold.
CREATE TABLE IF NOT EXISTS hub_focus_holds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  email TEXT NOT NULL,                      -- whose calendar
  event_id TEXT NOT NULL,                   -- the Google event
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_focus_request ON hub_focus_holds(request_id);

-- Where a meeting was booked from with Find a time: an email thread, a Chat conversation or thread, a task, a partner, a request.
-- The meeting card goes back there when it is booked and the notes go back there when they are ready (once, notes_posted).
CREATE TABLE IF NOT EXISTS hub_meeting_origins (
  meeting_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                       -- chat | mail | task | partner | request
  ref TEXT NOT NULL,                        -- channel id, mail thread id, task id, partner id or request id
  thread_id INTEGER,                        -- the Chat message the card went under, for kind chat
  card_message_id INTEGER,                  -- the Chat message that carries the meeting card
  booked_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notes_posted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_meeting_origins_ref ON hub_meeting_origins(kind, ref);

-- A clip recorded in place as a reply, and where it was shared: the email, Chat message, task comment or partner it answers.
-- Comments on the clip copy into that place and a reply there copies back onto the clip (hub_clip_mirror).
CREATE TABLE IF NOT EXISTS hub_clip_places (
  clip_id TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- chat | mail | task | partner
  ref TEXT NOT NULL,                        -- channel id, mail thread id, task id or partner id
  message_id INTEGER,                       -- the Chat message that carries the clip, for kind chat
  by_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (clip_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_clip_places_ref ON hub_clip_places(kind, ref);

-- One comment, two places: a clip comment and its copy in the Chat thread or task comments, so neither side copies it twice.
CREATE TABLE IF NOT EXISTS hub_clip_mirror (
  clip_comment_id TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- chat | task
  other_id TEXT NOT NULL,                   -- the Chat message id or the task comment id
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, other_id)
);
CREATE INDEX IF NOT EXISTS idx_clip_mirror_comment ON hub_clip_mirror(clip_comment_id);

-- A clip comment made into a task or marked as an adjustment. Linked both ways: the task carries the clip and the moment.
CREATE TABLE IF NOT EXISTS hub_clip_comment_marks (
  clip_comment_id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  task_id TEXT,                             -- the task made from it
  adjustment INTEGER NOT NULL DEFAULT 0,    -- 1 when marked as an adjustment to make
  adjustment_done INTEGER NOT NULL DEFAULT 0,
  by_email TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clip_marks_clip ON hub_clip_comment_marks(clip_id);

-- A clip sent to a partner that its sender chose to suggest for the contact log. Nothing is logged until the person confirms.
CREATE TABLE IF NOT EXISTS hub_clip_contact_log (
  clip_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  by_email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'suggested',  -- suggested | logged | dismissed | failed
  summary TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (clip_id, partner_id)
);

-- Each person's choices for meeting prep packs and the follow-up email. No row means the defaults: prep on, follow-up off.
CREATE TABLE IF NOT EXISTS hub_meeting_assist_prefs (
  email TEXT PRIMARY KEY,
  prep_on INTEGER NOT NULL DEFAULT 1,
  prep_recurring INTEGER NOT NULL DEFAULT 0, -- 1 also builds packs for internal repeating meetings
  followup_on INTEGER NOT NULL DEFAULT 0,
  followup_offered_at TEXT,                 -- when the one-time suggestion was shown
  followup_offer_closed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- A prep pack built for one person for one meeting, 15 minutes before it starts. Seen once in the dock, kept for the prep page.
CREATE TABLE IF NOT EXISTS hub_prep_packs (
  meeting_id TEXT NOT NULL,
  email TEXT NOT NULL,
  built_at TEXT NOT NULL,
  pack TEXT NOT NULL,                       -- JSON, the cards
  seen_at TEXT,
  PRIMARY KEY (meeting_id, email)
);
CREATE INDEX IF NOT EXISTS idx_prep_packs_email ON hub_prep_packs(email, built_at);

-- The follow-up email drafted after a meeting with outside attendees, for the host who turned it on. Opened in the composer, never sent here.
CREATE TABLE IF NOT EXISTS hub_meeting_followups (
  meeting_id TEXT NOT NULL,
  email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready',      -- ready | opened | dismissed
  to_list TEXT NOT NULL DEFAULT '[]',       -- JSON array of addresses
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, email)
);
