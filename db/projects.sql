-- Projects on the hub: projects, sections, tasks, comments, files, history and notices. Additive only.
-- Task codes are KEY-0001. A task with no project is a personal task. Nothing here touches the request board's tables.
CREATE TABLE IF NOT EXISTS hub_projects (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  lead_email TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'staff',
  status TEXT NOT NULL DEFAULT 'active',
  color TEXT NOT NULL DEFAULT 'leaf',
  start_date TEXT, due_date TEXT,
  chat_channel_id TEXT,
  drive_folder_id TEXT,
  next_num INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_project_members (project_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', added_at TEXT NOT NULL, PRIMARY KEY (project_id, email));
CREATE INDEX IF NOT EXISTS idx_hub_project_members_email ON hub_project_members(email);
CREATE TABLE IF NOT EXISTS hub_project_sections (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_hub_project_sections_project ON hub_project_sections(project_id, sort);
CREATE TABLE IF NOT EXISTS hub_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  section_id TEXT,
  code TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  owner_email TEXT,
  start_date TEXT, due_date TEXT, due_time TEXT,
  done_at TEXT, done_by TEXT,
  parent_id TEXT,
  sort REAL NOT NULL DEFAULT 0,
  waiting_on_email TEXT, waiting_on_task TEXT,
  appeal_code TEXT, source_code TEXT, fund_code TEXT, campaign_code TEXT,
  request_id TEXT,
  meeting_id TEXT, meeting_action_idx INTEGER,
  chat_message_id TEXT,
  expense_id TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_project ON hub_tasks(project_id, section_id, sort);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_owner ON hub_tasks(owner_email, status, due_date);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_due ON hub_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_hub_tasks_parent ON hub_tasks(parent_id);
-- Counts per project and the list filters on status read this index alone.
CREATE INDEX IF NOT EXISTS idx_hub_tasks_pstatus ON hub_tasks(project_id, status, due_date, parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_tasks_code ON hub_tasks(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_tasks_request ON hub_tasks(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_tasks_meeting ON hub_tasks(meeting_id, meeting_action_idx) WHERE meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_tasks_chatmsg ON hub_tasks(chat_message_id) WHERE chat_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS hub_task_people (task_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'follower', PRIMARY KEY (task_id, email, role));
CREATE INDEX IF NOT EXISTS idx_hub_task_people_email ON hub_task_people(email);
CREATE TABLE IF NOT EXISTS hub_task_deps (task_id TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY (task_id, depends_on));
CREATE INDEX IF NOT EXISTS idx_hub_task_deps_on ON hub_task_deps(depends_on);
CREATE TABLE IF NOT EXISTS hub_task_comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, author_email TEXT NOT NULL, body TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'hub', chat_message_id TEXT, created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS idx_hub_task_comments_task ON hub_task_comments(task_id, created_at);
CREATE TABLE IF NOT EXISTS hub_task_files (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', ref_id TEXT, mime TEXT, size INTEGER, added_by TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_hub_task_files_task ON hub_task_files(task_id);
CREATE TABLE IF NOT EXISTS hub_task_events (id TEXT PRIMARY KEY, task_id TEXT, project_id TEXT, actor_email TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_hub_task_events_task ON hub_task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hub_task_events_project ON hub_task_events(project_id, created_at);
CREATE TABLE IF NOT EXISTS hub_task_notices (id TEXT PRIMARY KEY, email TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL, actor_email TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, read_at TEXT, emailed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_hub_task_notices_email ON hub_task_notices(email, read_at);
