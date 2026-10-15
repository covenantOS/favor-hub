// Shapes of the answers from /api/projects and /api/tasks (functions/_lib/projects). Only the fields the screens read are named; every
// object keeps whatever else the server sends.

export interface Person {
  email: string;
  name: string;
  picture?: string;
  team?: string;
  title?: string;
}

export interface Staff {
  me: string;
  list: Person[];
}

export interface ProjectBrief {
  id: string;
  key: string;
  name: string;
  color: string;
}

export interface Project extends ProjectBrief {
  description: string;
  team: string;
  lead_email: string;
  lead: Person | null;
  visibility: 'staff' | 'members';
  status: string;
  start_date: string | null;
  due_date: string | null;
  open: number;
  done: number;
  overdue: number;
  asana_sync?: boolean;
  [k: string]: unknown;
}

export interface Section {
  id: string;
  project_id: string;
  name: string;
  sort: number;
}

export interface Member extends Person {
  role?: string;
}

export interface SubCounts {
  done: number;
  total: number;
}

export interface Task {
  id: string;
  project_id: string | null;
  section_id: string | null;
  code: string | null;
  title: string;
  description: string;
  status: 'open' | 'doing' | 'waiting' | 'done' | 'dropped' | string;
  priority: 'low' | 'normal' | 'high' | string;
  owner_email: string | null;
  owner: Person | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  done_at?: string | null;
  parent_id: string | null;
  sort: number;
  waiting_on_email?: string | null;
  waiting_on_task?: string | null;
  appeal_code: string | null;
  source_code: string | null;
  fund_code: string | null;
  campaign_code: string | null;
  request_id?: string | null;
  meeting?: { id: string; title: string; date: string } | null;
  project: ProjectBrief | null;
  section: string | null;
  subtasks: SubCounts;
  comments: number;
  files: number;
  overdue: boolean;
  blocked: boolean;
  pending?: boolean;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

export interface TaskCounts {
  by_section: Record<string, { open?: number; done?: number }>;
  [k: string]: unknown;
}

export interface TasksPage {
  tasks: Task[];
  total: number;
  counts: TaskCounts | null;
}

export interface FilterState {
  q: string;
  owner: string;
  priority: string;
  due: string;
  status: string;
  code: string;
}

export interface MineCounts {
  open: number;
  overdue: number;
  dueToday: number;
}

export type Dir = 'project' | 'mine' | 'solo';
