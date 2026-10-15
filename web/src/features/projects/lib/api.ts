// The browser client for /api/projects and /api/tasks: one function per route, each returning the parsed answer ({ ok: true, ... }) or
// throwing an Error with .code, .status and a message that is safe to show. Ported from public/js/projects/api.js (without the
// ?mock=1 fixture). Writes send X-Hub-Request, as every hub write does. Reads that the first paint needs go through hubGet instead
// (see queries.ts) so they also run on the server.
import type { Person, Project, Section, Member, Task, TaskCounts } from '../types';

export interface ApiError extends Error {
  code: string;
  status: number;
}

export const qs = (o: Record<string, unknown> | undefined): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
};

const enc = encodeURIComponent;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export async function call<T = Any>(method: string, path: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Hub-Request': '1' } as Record<string, string> };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined && method !== 'GET') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: opts?.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    const err = new Error('You look to be offline. Try again when the connection is back.') as ApiError;
    err.code = 'network';
    err.status = 0;
    throw err;
  }
  let data: Any = null;
  try {
    data = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok || !data || data.ok === false) {
    const err = new Error((data && data.message) || 'Something went wrong. Try again.') as ApiError;
    err.code = (data && data.error) || 'error';
    err.status = res.status;
    if (res.status === 401) err.code = 'signin';
    throw err;
  }
  return data as T;
}

export const api = {
  /* projects */
  projects: () => call<{ projects: Project[]; mine: { open: number; overdue: number; dueToday: number } }>('GET', '/api/projects'),
  project: (id: string) => call<{ project: Project; sections: Section[]; members: Member[]; counts: TaskCounts; can?: { manage: boolean; edit: boolean } }>('GET', `/api/projects/${enc(id)}`),
  createProject: (b: Record<string, unknown>) => call<{ project: Project }>('POST', '/api/projects', b),
  patchProject: (id: string, b: Record<string, unknown>) => call<{ project: Project }>('PATCH', `/api/projects/${enc(id)}`, b),
  createSection: (id: string, b: string | Record<string, unknown>) => call<{ section: Section }>('POST', `/api/projects/${enc(id)}/sections`, typeof b === 'string' ? { name: b } : b),
  patchSection: (id: string, sid: string, b: Record<string, unknown>) => call<{ section: Section }>('PATCH', `/api/projects/${enc(id)}/sections/${enc(sid)}`, b),
  deleteSection: (id: string, sid: string) => call('DELETE', `/api/projects/${enc(id)}/sections/${enc(sid)}`),
  members: (id: string, b: Record<string, unknown>) => call<{ members: Member[] }>('PUT', `/api/projects/${enc(id)}/members`, b),

  /* tasks */
  tasks: (q: Record<string, unknown>, opts?: { signal?: AbortSignal }) =>
    call<{ tasks: Task[]; total?: number; counts?: TaskCounts; has_more?: boolean; next_offset?: number | null }>('GET', '/api/tasks' + qs(q), undefined, opts),
  task: (id: string) => call<Any>('GET', `/api/tasks/${enc(id)}`),
  createTask: (b: Record<string, unknown>) => call<{ task: Task; existing?: boolean }>('POST', '/api/tasks', b),
  patchTask: (id: string, b: Record<string, unknown>) => call<{ task: Task }>('PATCH', `/api/tasks/${enc(id)}`, b),
  deleteTask: (id: string, hard?: boolean) => call('DELETE', `/api/tasks/${enc(id)}${hard ? '?hard=1' : ''}`),
  comment: (id: string, b: Record<string, unknown>) => call<Any>('POST', `/api/tasks/${enc(id)}/comments`, b),
  patchComment: (id: string, cid: string, b: Record<string, unknown>) => call<Any>('PATCH', `/api/tasks/${enc(id)}/comments/${enc(cid)}`, b),
  deleteComment: (id: string, cid: string) => call('DELETE', `/api/tasks/${enc(id)}/comments/${enc(cid)}`),
  addFile: (id: string, b: Record<string, unknown>) => call<Any>('POST', `/api/tasks/${enc(id)}/files`, b),
  deleteFile: (id: string, fid: string) => call('DELETE', `/api/tasks/${enc(id)}/files/${enc(fid)}`),
  upload: (id: string, file: File) => {
    const f = new FormData();
    f.append('file', file, file.name);
    return call<Any>('POST', `/api/tasks/${enc(id)}/upload`, f);
  },
  people: (id: string, b: Record<string, unknown>) => call<Any>('PUT', `/api/tasks/${enc(id)}/people`, b),
  deps: (id: string, b: Record<string, unknown>) => call<Any>('PUT', `/api/tasks/${enc(id)}/deps`, b),
  codes: (kind: string, q?: string) => call<{ codes: { code: string; description?: string }[] }>('GET', '/api/tasks/codes' + qs({ kind, q })),
  views: (project?: string) => call<{ views: { id: string; name: string; project_id: string | null; query: Record<string, unknown> }[] }>('GET', '/api/tasks/views' + qs({ project })),
  saveView: (b: Record<string, unknown>) => call<Any>('POST', '/api/tasks/views', b),
  deleteView: (id: string) => call('DELETE', '/api/tasks/views/' + enc(id)),
  notices: () => call<Any>('GET', '/api/tasks/notices'),
  readNotices: (b?: Record<string, unknown>) => call<Any>('POST', '/api/tasks/notices/read', b || { all: true }),

  /* planning, team workload and the Friday update */
  planDraft: (b: Record<string, unknown>) => call<Any>('POST', '/api/projects/plan/draft', b),
  planRefine: (b: Record<string, unknown>) => call<Any>('POST', '/api/projects/plan/refine', b),
  planCheck: (tasks: unknown) => call<Any>('POST', '/api/projects/plan/check', { tasks }),
  planCreate: (plan: unknown) => call<Any>('POST', '/api/projects/plan/create', { plan }),
  workload: (q?: Record<string, unknown>) => call<Any>('GET', '/api/projects/workload' + qs(q)),
  statusGet: (id: string) => call<Any>('GET', `/api/projects/${enc(id)}/status`),
  statusSet: (id: string, enabled: boolean) => call<Any>('PUT', `/api/projects/${enc(id)}/status`, { enabled }),
  statusDraft: (id: string) => call<Any>('GET', `/api/projects/${enc(id)}/status/draft`),
  statusPost: (id: string) => call<Any>('POST', `/api/projects/${enc(id)}/status/post`, {}),

  /** The staff list for pickers: { me, people: [{ email, name, team, title, picture }] }. */
  directory: () => call<{ me: string; people: Person[] }>('GET', '/api/requests/people'),
};

export default api;
