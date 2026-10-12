CREATE TABLE IF NOT EXISTS hub_projects (
  id TEXT PRIMARY KEY,              -- random id
  key TEXT NOT NULL UNIQUE,         -- 2 to 5 capital letters, e.g. MKT; task codes are KEY-0001
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',    -- free text shown as a chip (Marketing, Grants ...)
  lead_email TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'staff',   -- 'staff' (every signed-in staff member can see) | 'members'
  status TEXT NOT NULL DEFAULT 'active',      -- active | paused | done | archived
  color TEXT NOT NULL DEFAULT 'leaf',         -- a round2 token name
  start_date TEXT, due_date TEXT,             -- YYYY-MM-DD
  chat_channel_id TEXT,                       -- set by lane LINKS
  drive_folder_id TEXT,                       -- set by lane LINKS
  next_num INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_project_members (project_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', added_at TEXT NOT NULL, PRIMARY KEY (project_id, email));
CREATE TABLE IF NOT EXISTS hub_project_sections (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hub_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,                  -- NULL = a personal task with no project
  section_id TEXT,
  code TEXT,                        -- KEY-0001; NULL for personal tasks
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',        -- open | doing | waiting | done | dropped
  priority TEXT NOT NULL DEFAULT 'normal',    -- low | normal | high
  owner_email TEXT,                           -- the one person responsible; NULL = unassigned
  start_date TEXT, due_date TEXT, due_time TEXT,   -- dates YYYY-MM-DD, time HH:MM Eastern or NULL
  done_at TEXT, done_by TEXT,
  parent_id TEXT,                             -- a subtask of this task
  sort REAL NOT NULL DEFAULT 0,               -- order inside its section (and inside the board column)
  waiting_on_email TEXT, waiting_on_task TEXT,
  appeal_code TEXT, source_code TEXT, fund_code TEXT, campaign_code TEXT,   -- Favor's Blackbaud codes, optional
  request_id TEXT,                            -- made from a request board card
  meeting_id TEXT, meeting_action_idx INTEGER, -- made from a meeting action item
  chat_message_id TEXT,                       -- made from a Chat message
  expense_id TEXT,                            -- linked expense request
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_project ON hub_tasks(project_id, section_id, sort);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_owner ON hub_tasks(owner_email, status, due_date);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_due ON hub_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_parent ON hub_tasks(parent_id);
CREATE TABLE IF NOT EXISTS hub_task_people (task_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'follower', PRIMARY KEY (task_id, email, role));  -- role: collab | follower
CREATE TABLE IF NOT EXISTS hub_task_deps (task_id TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY (task_id, depends_on));  -- finish-to-start
CREATE TABLE IF NOT EXISTS hub_task_comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, author_email TEXT NOT NULL, body TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'hub', chat_message_id TEXT, created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS idx_hub_task_comments_task ON hub_task_comments(task_id, created_at);
CREATE TABLE IF NOT EXISTS hub_task_files (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', ref_id TEXT, mime TEXT, size INTEGER, added_by TEXT NOT NULL, added_at TEXT NOT NULL);  -- kind: upload | drive | clip | link
CREATE TABLE IF NOT EXISTS hub_task_events (id TEXT PRIMARY KEY, task_id TEXT, project_id TEXT, actor_email TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_hub_task_events_task ON hub_task_events(task_id, created_at);
CREATE TABLE IF NOT EXISTS hub_task_notices (id TEXT PRIMARY KEY, email TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL, actor_email TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, read_at TEXT, emailed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_hub_task_notices_email ON hub_task_notices(email, read_at);
