-- Learn, Favor's learning system inside FavorOS (2026-10-11, lane LEARN). Additive only: new tables, nothing in an existing table
-- changes. Not applied to production by the lane. Apply with
--   wrangler d1 execute favor-requests --remote --file db/learn.sql
-- Courses hold lessons (a help video, a help article, a Google Doc or PDF, a written page, a clip, a link or a quiz). A path is an
-- ordered set of courses. An assignment gives a person a course or a path with a due date. Progress, quiz attempts and completion
-- records are kept for each person. Names and addresses are never seeded from this file (the repository is public); the starter
-- courses are written by the hub itself the first time Learn opens (functions/_lib/learn/seed.ts).

CREATE TABLE IF NOT EXISTS learn_courses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',          -- who it is for, in words: Everyone, RDDs, Partner Care ...
  color TEXT NOT NULL DEFAULT 'leaf',         -- a round2 tint name: leaf | teal | sky | sun | dusk | terra | slate
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | published | archived
  seed_key TEXT,                              -- set on a starter course so it is written once
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learn_courses_seed ON learn_courses(seed_key) WHERE seed_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learn_courses_status ON learn_courses(status);

CREATE TABLE IF NOT EXISTS learn_lessons (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  sort REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,                         -- video | article | doc | page | clip | link | quiz
  title TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',               -- help video slug, help article slug, a Drive or web address, a clip id
  body TEXT NOT NULL DEFAULT '',              -- the text of a written page, or the quiz as JSON
  minutes INTEGER NOT NULL DEFAULT 0,         -- about how long it takes
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_lessons_course ON learn_lessons(course_id, sort);

CREATE TABLE IF NOT EXISTS learn_paths (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'leaf',
  status TEXT NOT NULL DEFAULT 'draft',
  seed_key TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learn_paths_seed ON learn_paths(seed_key) WHERE seed_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS learn_path_courses (
  path_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  sort REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (path_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_learn_path_courses_course ON learn_path_courses(course_id);

-- One row per person per course or path given to them. Removing an assignment keeps the row with closed_why = 'removed'; giving
-- it again opens the same row.
CREATE TABLE IF NOT EXISTS learn_assignments (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- course | path
  target_id TEXT NOT NULL,                    -- learn_courses.id or learn_paths.id
  due_date TEXT,                              -- YYYY-MM-DD, Eastern
  source TEXT NOT NULL DEFAULT 'manual',      -- manual | team | everyone | onboarding
  group_label TEXT NOT NULL DEFAULT '',       -- "Grants", "Everyone": how it was given
  note TEXT NOT NULL DEFAULT '',
  assigned_by TEXT NOT NULL DEFAULT '',
  assigned_at TEXT NOT NULL,
  task_id TEXT,                               -- the hub_tasks row in Projects, when Projects is on
  closed_at TEXT,
  closed_why TEXT,                            -- complete | removed
  UNIQUE (email, kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_learn_assignments_email ON learn_assignments(email, closed_at);
CREATE INDEX IF NOT EXISTS idx_learn_assignments_target ON learn_assignments(kind, target_id);
CREATE INDEX IF NOT EXISTS idx_learn_assignments_due ON learn_assignments(due_date);

CREATE TABLE IF NOT EXISTS learn_progress (
  email TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'started',      -- started | done
  position INTEGER NOT NULL DEFAULT 0,        -- seconds into a video
  updated_at TEXT NOT NULL,
  done_at TEXT,
  PRIMARY KEY (email, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_learn_progress_course ON learn_progress(email, course_id);
CREATE INDEX IF NOT EXISTS idx_learn_progress_lesson ON learn_progress(lesson_id);

CREATE TABLE IF NOT EXISTS learn_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  score INTEGER NOT NULL,                     -- percent
  passed INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_attempts_who ON learn_attempts(email, lesson_id, created_at);
CREATE INDEX IF NOT EXISTS idx_learn_attempts_course ON learn_attempts(course_id);

-- The completion record behind the certificate page.
CREATE TABLE IF NOT EXISTS learn_completions (
  email TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_title TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  cert TEXT NOT NULL UNIQUE,                  -- the number printed on the certificate
  PRIMARY KEY (email, course_id)
);
CREATE INDEX IF NOT EXISTS idx_learn_completions_course ON learn_completions(course_id);

-- Reminders. Saved only for people requests.notify lets through (the same gate as the request board); email follows each one.
CREATE TABLE IF NOT EXISTS learn_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- assigned | due_soon | due_today | overdue
  assignment_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT,
  emailed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_learn_notices_email ON learn_notices(email, read_at);
CREATE INDEX IF NOT EXISTS idx_learn_notices_assignment ON learn_notices(assignment_id, kind);
