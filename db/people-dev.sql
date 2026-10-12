-- People development, lane EVAL (2026-10-11). Additive only, never applied to production by the lane.
--   hub_reporting   who each person reports to, their department, title and start date. Edited in Admin > People.
--                   Learn, Onboarding and Evaluations all read it through functions/_lib/people-dev.ts.
--   hub_hr          people an admin marked as HR. They get admin rights in Evaluations, Learn authoring and Onboarding only.
-- Staff names and addresses are not seeded from this file (the repository is public). The seed lives outside it.

CREATE TABLE IF NOT EXISTS hub_reporting (
  email TEXT PRIMARY KEY,
  supervisor_email TEXT,
  department TEXT,
  title TEXT,
  start_date TEXT,
  updated_by TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_reporting_supervisor ON hub_reporting(supervisor_email);

CREATE TABLE IF NOT EXISTS hub_hr (
  email TEXT PRIMARY KEY,
  set_by TEXT,
  set_at TEXT
);

-- Evaluations. Answers are sensitive HR data and never reach search, Favor Brain, dashboards or Chat.
-- A term is one semiannual round for a group of people.
CREATE TABLE IF NOT EXISTS eval_terms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  period_label TEXT NOT NULL,            -- January to June 2027
  starts_on TEXT NOT NULL,               -- week 1 begins
  status TEXT NOT NULL DEFAULT 'open',   -- open | closed
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One evaluation per person per term.
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  supervisor_email TEXT,                 -- copied from hub_reporting when the term opens, changeable by drop-down
  stage TEXT NOT NULL DEFAULT 'self',    -- self | feedback | summary | meeting | acknowledged | signed | done
  w1_due TEXT, w2_due TEXT, w3_due TEXT,
  self_submitted_at TEXT,
  reviewers_chosen_at TEXT,
  summary_submitted_at TEXT,
  meeting_on TEXT,
  acknowledged_at TEXT,
  acknowledged_note TEXT,
  signed_by TEXT,
  signed_at TEXT,
  doc_url TEXT,
  doc_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (term_id, employee_email)
);
CREATE INDEX IF NOT EXISTS idx_eval_cases_emp ON eval_cases(employee_email);
CREATE INDEX IF NOT EXISTS idx_eval_cases_sup ON eval_cases(supervisor_email);

-- Form B reviewers. The employee picks 3 to 5, the supervisor may adjust.
CREATE TABLE IF NOT EXISTS eval_reviewers (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'asked',  -- asked | submitted | declined
  asked_at TEXT NOT NULL,
  submitted_at TEXT,
  reminded_at TEXT,
  UNIQUE (case_id, reviewer_email)
);
CREATE INDEX IF NOT EXISTS idx_eval_reviewers_rev ON eval_reviewers(reviewer_email);

-- Every answer. form is A (self), B (reviewer) or C (supervisor). author_email is who wrote it.
-- qid is the question id in src/data/evaluation-forms.ts. rating is 1 to 5, or 0 for Not Observed.
CREATE TABLE IF NOT EXISTS eval_answers (
  case_id TEXT NOT NULL,
  form TEXT NOT NULL,
  author_email TEXT NOT NULL,
  qid TEXT NOT NULL,
  rating INTEGER,
  text TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (case_id, form, author_email, qid)
);

-- Form C's six-month plan, 2 to 4 goals. task_id links the Projects task made for the employee.
CREATE TABLE IF NOT EXISTS eval_goals (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  area TEXT NOT NULL,                    -- Professional Skills | Communication and Teamwork | Leadership and Character | Role-Specific Development
  goal TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '',
  support TEXT NOT NULL DEFAULT '',
  target_date TEXT,
  course_id TEXT,                        -- a Learn course, optional
  task_id TEXT,
  review_status TEXT NOT NULL DEFAULT '',  -- set at the next cycle: met | partly | not_met
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_goals_case ON eval_goals(case_id);
CREATE INDEX IF NOT EXISTS idx_eval_goals_emp ON eval_goals(employee_email);

-- Reminders already sent, so a reload or a second run never sends one twice.
CREATE TABLE IF NOT EXISTS eval_nudges (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
