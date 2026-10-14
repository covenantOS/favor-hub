/* Projects: the client for /api/projects and /api/tasks. One function per route, all returning the parsed JSON
   ({ok:true, ...}) or throwing an Error with .code, .status and a message that is safe to show.
   Add ?mock=1 to a projects page address and the same functions answer from an in-memory fixture (mock.js), so a
   screen can be built and tested before the server is there. Nothing is written anywhere in mock mode.

   import { api } from '/js/projects/api.js';
   const { projects, mine } = await api.projects();
   const { tasks, total } = await api.tasks({ project: 'MKT', status: 'open' });
   await api.patchTask('MKT-0003', { done: true });
*/
const MOCK = (() => {
  try { return new URLSearchParams(location.search).get('mock') === '1'; } catch (_) { return false; }
})();

let mockP = null;
const mockApi = () => (mockP || (mockP = import('./mock.js').then((m) => m.createMock())));

const enc = encodeURIComponent;

/** Turns {a:1,b:'',c:null} into "?a=1", dropping empty values. */
export function qs(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

async function call(method, path, body, opts) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined && method !== 'GET') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, { ...init, signal: opts && opts.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    const err = new Error('You look to be offline. Try again when the connection is back.');
    err.code = 'network';
    err.status = 0;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* not JSON */ }
  if (!res.ok || !data || data.ok === false) {
    const err = new Error((data && data.message) || 'Something went wrong. Try again.');
    err.code = (data && data.error) || 'error';
    err.status = res.status;
    if (res.status === 401) err.code = 'signin';
    throw err;
  }
  return data;
}

function localViews(set) {
  try {
    if (set) localStorage.setItem('favor.hub.projects.mockviews', JSON.stringify(set));
    return JSON.parse(localStorage.getItem('favor.hub.projects.mockviews') || '[]');
  } catch (_) { return []; }
}

/** In mock mode a route is served by mock.js under the same name; otherwise by the network. */
function route(name, real) {
  return async (...a) => {
    if (MOCK) return (await mockApi())[name](...a);
    return real(...a);
  };
}

export const api = {
  mock: MOCK,
  qs,

  /* projects */
  projects: route('projects', () => call('GET', '/api/projects')),
  project: route('project', (id) => call('GET', `/api/projects/${enc(id)}`)),
  createProject: route('createProject', (b) => call('POST', '/api/projects', b)),
  patchProject: route('patchProject', (id, b) => call('PATCH', `/api/projects/${enc(id)}`, b)),
  createSection: route('createSection', (id, b) => call('POST', `/api/projects/${enc(id)}/sections`, typeof b === 'string' ? { name: b } : b)),
  patchSection: route('patchSection', (id, sid, b) => call('PATCH', `/api/projects/${enc(id)}/sections/${enc(sid)}`, b)),
  deleteSection: route('deleteSection', (id, sid) => call('DELETE', `/api/projects/${enc(id)}/sections/${enc(sid)}`)),
  members: route('members', (id, b) => call('PUT', `/api/projects/${enc(id)}/members`, b)),

  /* tasks */
  tasks: route('tasks', (q, opts) => call('GET', '/api/tasks' + qs(q), undefined, opts)),
  task: route('task', (id) => call('GET', `/api/tasks/${enc(id)}`)),
  createTask: route('createTask', (b) => call('POST', '/api/tasks', b)),
  patchTask: route('patchTask', (id, b) => call('PATCH', `/api/tasks/${enc(id)}`, b)),
  deleteTask: route('deleteTask', (id, hard) => call('DELETE', `/api/tasks/${enc(id)}${hard ? '?hard=1' : ''}`)),
  comment: route('comment', (id, b) => call('POST', `/api/tasks/${enc(id)}/comments`, b)),
  patchComment: route('patchComment', (id, cid, b) => call('PATCH', `/api/tasks/${enc(id)}/comments/${enc(cid)}`, b)),
  deleteComment: route('deleteComment', (id, cid) => call('DELETE', `/api/tasks/${enc(id)}/comments/${enc(cid)}`)),
  addFile: route('addFile', (id, b) => call('POST', `/api/tasks/${enc(id)}/files`, b)),
  deleteFile: route('deleteFile', (id, fid) => call('DELETE', `/api/tasks/${enc(id)}/files/${enc(fid)}`)),
  upload: route('upload', (id, file) => {
    const f = new FormData();
    f.append('file', file, file.name);
    return call('POST', `/api/tasks/${enc(id)}/upload`, f);
  }),
  people: route('people', (id, b) => call('PUT', `/api/tasks/${enc(id)}/people`, b)),
  deps: route('deps', (id, b) => call('PUT', `/api/tasks/${enc(id)}/deps`, b)),
  codes: route('codes', (kind, q) => call('GET', '/api/tasks/codes' + qs({ kind, q }))),
  /* saved views, kept per person (a mock-mode page keeps them in this browser) */
  views: async (project) => {
    if (MOCK) return { ok: true, views: localViews().filter((v) => (v.project_id || '') === (project || '')) };
    return call('GET', '/api/tasks/views' + qs({ project }));
  },
  saveView: async (b) => {
    if (MOCK) {
      const all = localViews();
      const same = all.find((v) => v.name === b.name && (v.project_id || '') === (b.project_id || ''));
      const v = same || { id: 'vw_' + Math.random().toString(36).slice(2, 9), project_id: b.project_id || null, name: b.name, created_at: new Date().toISOString() };
      v.query = b.query || {};
      if (!same) all.push(v);
      localViews(all);
      return { ok: true, view: v };
    }
    return call('POST', '/api/tasks/views', b);
  },
  deleteView: async (id) => {
    if (MOCK) { localViews(localViews().filter((v) => v.id !== id)); return { ok: true }; }
    return call('DELETE', '/api/tasks/views/' + enc(id));
  },
  notices: route('notices', () => call('GET', '/api/tasks/notices')),
  readNotices: route('readNotices', (b) => call('POST', '/api/tasks/notices/read', b || { all: true })),

  /* planning, team workload and the Friday update (always the network; the mock fixture has no plans) */
  planDraft: (b) => call('POST', '/api/projects/plan/draft', b),
  planRefine: (b) => call('POST', '/api/projects/plan/refine', b),
  planCheck: (tasks) => call('POST', '/api/projects/plan/check', { tasks }),
  planCreate: (plan) => call('POST', '/api/projects/plan/create', { plan }),
  workload: (q) => call('GET', '/api/projects/workload' + qs(q)),
  statusGet: (id) => call('GET', `/api/projects/${enc(id)}/status`),
  statusSet: (id, enabled) => call('PUT', `/api/projects/${enc(id)}/status`, { enabled }),
  statusDraft: (id) => call('GET', `/api/projects/${enc(id)}/status/draft`),
  statusPost: (id) => call('POST', `/api/projects/${enc(id)}/status/post`, {}),

  /** The staff list for pickers: {ok, me, people:[{email,name,team,title,picture}]}. Shared with the request board. */
  directory: route('directory', () => call('GET', '/api/requests/people')),
};

export default api;
