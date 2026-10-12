// Asana as a source of projects for the hub. Two kinds of source feed one importer (asana-import.ts):
//   AsanaApiSource    the Asana REST API (https://developers.asana.com/reference), read only: GET requests, nothing is created,
//                     changed or posted in Asana. Pages with next_page.offset, 429 with Retry-After, opt_fields on every read.
//   ExportSource      a project export file: Asana's JSON export (a data envelope with tasks, or a list of projects) or its CSV export
//                     (Task ID, Created At, Completed At, Last Modified, Name, Section/Column, Assignee, Assignee Email, Start Date,
//                     Due Date, Tags, Notes, Projects, Parent task, Blocked By (Dependencies), Blocking (Dependencies), then one
//                     column per custom field).
// Both answer with the same small shapes below, so the importer never knows which one it is reading.

export interface AUser {
  gid?: string;
  name: string;
  email: string;
}
export interface ASection {
  gid: string;
  name: string;
}
export interface AProjectLite {
  gid: string;
  name: string;
  archived: boolean;
  team: string;
  owner: string;
  color: string;
  tasks?: number;
}
export interface AProject {
  gid: string;
  name: string;
  notes: string;
  archived: boolean;
  color: string;
  start_on: string | null;
  due_on: string | null;
  owner: AUser | null;
  members: AUser[];
  sections: ASection[];
  created_at: string;
  permalink: string;
  num_tasks: number | null;
}
export interface AField {
  name: string;
  type: string;
  value: string;
  people: AUser[];
}
export interface ATask {
  gid: string;
  name: string;
  notes: string;
  completed: boolean;
  completed_at: string | null;
  completed_by: AUser | null;
  created_at: string;
  created_by: AUser | null;
  modified_at: string;
  assignee: AUser | null;
  start_on: string | null;
  start_at: string | null;
  due_on: string | null;
  due_at: string | null;
  section: ASection | null;
  parent: string | null;
  num_subtasks: number;
  followers: AUser[];
  tags: string[];
  fields: AField[];
  other_projects: string[];
  permalink: string;
  /** Export files carry these inline. The API source fetches them with their own calls. */
  inline?: { subtasks?: ATask[]; stories?: AStory[]; attachments?: AAttachment[]; deps?: string[] };
}
export interface AStory {
  gid: string;
  created_at: string;
  author: AUser | null;
  text: string;
}
export interface AAttachment {
  gid: string;
  name: string;
  host: string; // asana | external service name
  size: number | null;
  download_url: string;
  permanent_url: string;
  created_at: string;
}
export interface Downloaded {
  bytes: ArrayBuffer;
  type: string;
}

export interface Source {
  kind: 'api' | 'export';
  calls: number;
  projects(opts?: { archived?: boolean }): Promise<AProjectLite[]>;
  project(ref: string): Promise<AProject>;
  taskPage(ref: string, cursor: string | null, o: { since?: string }): Promise<{ tasks: ATask[]; next: string | null }>;
  subtasks(t: ATask): Promise<ATask[]>;
  stories(t: ATask): Promise<AStory[]>;
  attachments(t: ATask): Promise<AAttachment[]>;
  dependencies(t: ATask): Promise<string[]>;
  download(a: AAttachment, maxBytes: number): Promise<Downloaded | { tooBig: true } | null>;
}

/* ------------------------------------------------------------------------------------------------ small helpers */

const s = (v: unknown): string => (v == null ? '' : String(v));
const lower = (v: unknown) => s(v).trim().toLowerCase();

export function asUser(v: any): AUser | null {
  if (!v || typeof v !== 'object') return null;
  const name = s(v.name).trim();
  const email = lower(v.email);
  if (!name && !email && !v.gid) return null;
  return { gid: v.gid ? s(v.gid) : undefined, name, email };
}
const users = (v: any): AUser[] => (Array.isArray(v) ? (v.map(asUser).filter(Boolean) as AUser[]) : []);
const day = (v: unknown): string | null => {
  const t = s(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};

/** Asana names its project colors; the hub names its tokens. */
export function hubColor(asana: string): string {
  const c = lower(asana);
  if (!c) return 'leaf';
  if (/green|lime|olive/.test(c)) return 'leaf';
  if (/teal|aqua|cool-gray|blue-green/.test(c)) return 'teal';
  if (/yellow|orange|sun|gold/.test(c)) return 'sun';
  if (/blue|sky/.test(c)) return 'sky';
  if (/purple|indigo|violet|hot-pink|pink|magenta/.test(c)) return 'dusk';
  if (/red|brown|terra|salmon|peach/.test(c)) return 'terra';
  return 'slate';
}

export class AsanaAuthError extends Error {}
/** Asana's page tokens last 15 minutes. A run that comes back later starts the list again and skips what it already did. */
export class OffsetExpired extends Error {}
export class RateLimited extends Error {
  waitSec: number;
  constructor(waitSec: number) {
    super(`Asana asked us to wait ${waitSec} seconds.`);
    this.waitSec = waitSec;
  }
}

/* ------------------------------------------------------------------------------------------------- API source */

export interface ApiOpts {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Pause between calls, so a long run stays under Asana's limit (150 a minute on the free tier, 1,500 paid). */
  paceMs?: number;
  /** A moment (ms since epoch) after which a step must stop instead of waiting out a rate limit. */
  deadline?: number;
  now?: () => number;
  workspace?: string;
}

const TASK_FIELDS = [
  'name', 'notes', 'completed', 'completed_at', 'completed_by.name', 'completed_by.email', 'created_at', 'created_by.name', 'created_by.email',
  'modified_at', 'assignee.name', 'assignee.email', 'start_on', 'start_at', 'due_on', 'due_at', 'parent.gid', 'num_subtasks',
  'followers.name', 'followers.email', 'tags.name', 'custom_fields.name', 'custom_fields.type', 'custom_fields.display_value',
  'custom_fields.people_value.name', 'custom_fields.people_value.email', 'memberships.project.gid', 'memberships.project.name',
  'memberships.section.gid', 'memberships.section.name', 'permalink_url', 'resource_subtype',
].join(',');

export function taskFromApi(r: any, projectGid: string): ATask {
  const mem = (Array.isArray(r.memberships) ? r.memberships : []) as any[];
  const here = mem.find((m) => s(m?.project?.gid) === projectGid) || null;
  const sec = here?.section?.gid ? { gid: s(here.section.gid), name: s(here.section.name) } : null;
  return {
    gid: s(r.gid),
    name: s(r.name),
    notes: s(r.notes),
    completed: !!r.completed,
    completed_at: r.completed_at ? s(r.completed_at) : null,
    completed_by: asUser(r.completed_by),
    created_at: s(r.created_at),
    created_by: asUser(r.created_by),
    modified_at: s(r.modified_at) || s(r.created_at),
    assignee: asUser(r.assignee),
    start_on: day(r.start_on),
    start_at: r.start_at ? s(r.start_at) : null,
    due_on: day(r.due_on),
    due_at: r.due_at ? s(r.due_at) : null,
    section: sec,
    parent: r.parent?.gid ? s(r.parent.gid) : null,
    num_subtasks: Number(r.num_subtasks) || 0,
    followers: users(r.followers),
    tags: (Array.isArray(r.tags) ? r.tags : []).map((t: any) => s(t?.name).trim()).filter(Boolean),
    fields: (Array.isArray(r.custom_fields) ? r.custom_fields : []).map((f: any) => ({
      name: s(f?.name).trim(),
      type: s(f?.type),
      value: s(f?.display_value ?? '').trim(),
      people: users(f?.people_value),
    })).filter((f: AField) => f.name && (f.value || f.people.length)),
    other_projects: mem.filter((m) => m?.project?.gid && s(m.project.gid) !== projectGid).map((m) => s(m.project.name || m.project.gid)),
    permalink: s(r.permalink_url),
  };
}

export class AsanaApiSource implements Source {
  kind = 'api' as const;
  calls = 0;
  private o: ApiOpts;
  constructor(o: ApiOpts) {
    this.o = o;
  }
  private get base() {
    return (this.o.baseUrl || 'https://app.asana.com/api/1.0').replace(/\/$/, '');
  }
  private now() {
    return (this.o.now || Date.now)();
  }
  private async sleep(ms: number) {
    await (this.o.sleep || ((n: number) => new Promise<void>((r) => setTimeout(r, n))))(ms);
  }

  /** One GET. Waits out a short rate limit, throws RateLimited when the wait would outlast the step. */
  async get(path: string, params: Record<string, string | number | undefined> = {}): Promise<{ data: any; next: string | null }> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const f = this.o.fetch || fetch;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.o.paceMs) await this.sleep(this.o.paceMs);
      this.calls++;
      const res = await f(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${this.o.token}`, Accept: 'application/json' } });
      lastStatus = res.status;
      if (res.status === 429) {
        const wait = Math.max(1, Math.ceil(Number(res.headers.get('Retry-After')) || 30));
        const left = this.o.deadline ? this.o.deadline - this.now() : Infinity;
        if (wait * 1000 > left) throw new RateLimited(wait);
        await this.sleep(wait * 1000);
        continue;
      }
      if (res.status >= 500) {
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) throw new AsanaAuthError('Asana did not accept the token.');
      if (res.status === 403) throw new AsanaAuthError('The token does not have access to that part of Asana.');
      const body = (await res.json().catch(() => ({}))) as any;
      if (res.status === 404) return { data: null, next: null };
      if (res.status === 400 && /offset/i.test(s(body?.errors?.[0]?.message))) throw new OffsetExpired('The page marker expired.');
      if (!res.ok) throw new Error(`Asana said ${res.status}: ${s(body?.errors?.[0]?.message) || 'no reason given'}`);
      return { data: body.data, next: body.next_page?.offset ? s(body.next_page.offset) : null };
    }
    throw new Error(`Asana kept answering ${lastStatus}.`);
  }

  async me() {
    const r = await this.get('/users/me', { opt_fields: 'name,email,workspaces.name,workspaces.gid' });
    return r.data as { gid: string; name: string; email: string; workspaces: Array<{ gid: string; name: string }> };
  }

  private async all(path: string, params: Record<string, string | number | undefined>, max = 5000): Promise<any[]> {
    const out: any[] = [];
    let offset: string | null = null;
    do {
      const r = await this.get(path, { ...params, limit: 100, offset: offset || undefined });
      if (Array.isArray(r.data)) out.push(...r.data);
      offset = r.next;
    } while (offset && out.length < max);
    return out;
  }

  async projects(opts: { archived?: boolean } = {}): Promise<AProjectLite[]> {
    const ws = this.o.workspace || (await this.me()).workspaces?.[0]?.gid;
    if (!ws) throw new Error('This Asana account has no workspace.');
    const rows = await this.all('/projects', { workspace: ws, archived: opts.archived ? 'true' : 'false', opt_fields: 'name,archived,color,team.name,owner.name' });
    const mine = rows.map((r) => ({ gid: s(r.gid), name: s(r.name), archived: !!r.archived, team: s(r.team?.name), owner: s(r.owner?.name), color: s(r.color) }));
    if (opts.archived) return mine;
    return mine.filter((p) => !p.archived);
  }

  async project(ref: string): Promise<AProject> {
    const [p, secs, counts] = await Promise.all([
      this.get(`/projects/${ref}`, { opt_fields: 'name,notes,archived,color,start_on,due_on,owner.name,owner.email,members.name,members.email,created_at,permalink_url' }),
      this.all(`/projects/${ref}/sections`, { opt_fields: 'name' }),
      this.get(`/projects/${ref}/task_counts`, { opt_fields: 'num_tasks' }),
    ]);
    const r = p.data;
    if (!r) throw new Error(`Asana has no project ${ref}, or the token cannot see it.`);
    return {
      gid: s(r.gid), name: s(r.name), notes: s(r.notes), archived: !!r.archived, color: s(r.color), start_on: day(r.start_on), due_on: day(r.due_on),
      owner: asUser(r.owner), members: users(r.members), sections: secs.map((x) => ({ gid: s(x.gid), name: s(x.name) })), created_at: s(r.created_at),
      permalink: s(r.permalink_url), num_tasks: counts.data && Number.isFinite(Number(counts.data.num_tasks)) ? Number(counts.data.num_tasks) : null,
    };
  }

  async taskPage(ref: string, cursor: string | null, o: { since?: string }) {
    const r = await this.get('/tasks', { project: ref, opt_fields: TASK_FIELDS, limit: 20, offset: cursor || undefined, modified_since: o.since });
    return { tasks: ((r.data as any[]) || []).map((t) => taskFromApi(t, ref)), next: r.next };
  }

  async subtasks(t: ATask): Promise<ATask[]> {
    const rows = await this.all(`/tasks/${t.gid}/subtasks`, { opt_fields: TASK_FIELDS });
    return rows.map((r) => taskFromApi(r, ''));
  }

  async stories(t: ATask): Promise<AStory[]> {
    const rows = await this.all(`/tasks/${t.gid}/stories`, { opt_fields: 'created_at,created_by.name,created_by.email,text,type,resource_subtype' });
    return rows
      .filter((r) => r.resource_subtype === 'comment_added' || r.type === 'comment')
      .map((r) => ({ gid: s(r.gid), created_at: s(r.created_at), author: asUser(r.created_by), text: s(r.text) }))
      .filter((c) => c.text.trim());
  }

  async attachments(t: ATask): Promise<AAttachment[]> {
    const rows = await this.all('/attachments', { parent: t.gid, opt_fields: 'name,host,size,download_url,permanent_url,view_url,created_at,resource_subtype' });
    return rows.map((r) => ({
      gid: s(r.gid), name: s(r.name) || 'attachment', host: lower(r.host) || (r.resource_subtype === 'external' ? 'external' : 'asana'),
      size: Number.isFinite(Number(r.size)) && r.size != null ? Number(r.size) : null,
      download_url: s(r.download_url), permanent_url: s(r.permanent_url || r.view_url), created_at: s(r.created_at),
    }));
  }

  async dependencies(t: ATask): Promise<string[]> {
    const rows = await this.all(`/tasks/${t.gid}/dependencies`, { opt_fields: 'gid' });
    return rows.map((r) => s(r.gid)).filter(Boolean);
  }

  download(a: AAttachment, maxBytes: number) {
    return downloadFile(this.o.fetch || fetch, a, maxBytes);
  }
}

/** The file behind an attachment. Asana's download address is pre-signed, so no token goes with it. */
export async function downloadFile(f: typeof fetch, a: AAttachment, maxBytes: number): Promise<Downloaded | { tooBig: true } | null> {
  if (!a.download_url) return null;
  if (a.size != null && a.size > maxBytes) return { tooBig: true };
  try {
    const res = await f(a.download_url, { method: 'GET' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    if (len && len > maxBytes) return { tooBig: true };
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > maxBytes) return { tooBig: true };
    return { bytes, type: res.headers.get('content-type') || '' };
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------------------------- export source */

export interface ExportedProject {
  project: AProject;
  tasks: ATask[]; // top level tasks, subtasks inline
}

/** RFC 4180 reader: quotes, doubled quotes, commas and line breaks inside quotes, a byte order mark. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const CSV_KNOWN = new Set([
  'task id', 'created at', 'completed at', 'last modified', 'name', 'section/column', 'assignee', 'assignee email', 'start date', 'due date', 'tags',
  'notes', 'projects', 'parent task', 'blocked by (dependencies)', 'blocking (dependencies)',
]);

/** A dependency cell lists task names (or Task IDs) separated by commas, and a name can hold a comma, so take the longest run of pieces that is a known task. */
function namesToIds(cell: string, names: Map<string, string>, all: Map<string, ATask>): string[] {
  const out: string[] = [];
  const pieces = cell.split(/[,;]/).map((x) => x.trim());
  let i = 0;
  while (i < pieces.length) {
    let hit = 0;
    for (let j = pieces.length; j > i; j--) {
      const cand = pieces.slice(i, j).join(', ');
      const id = names.get(cand) || (all.has(cand) ? cand : '');
      if (id) {
        out.push(id);
        hit = j - i;
        break;
      }
    }
    if (!hit) {
      if (pieces[i]) out.push(pieces[i]);
      hit = 1;
    }
    i += hit;
  }
  return out;
}

/** One CSV export is one project. Its name comes from the Projects column or the file name. */
export function parseCsvExport(text: string, fileName = 'Asana export'): ExportedProject {
  const rows = parseCsv(text);
  if (rows.length < 1) throw new Error('The CSV file is empty.');
  const head = rows[0].map((h) => lower(h));
  const col = (n: string) => head.indexOf(n);
  if (col('name') < 0 || col('task id') < 0) throw new Error('This CSV does not look like an Asana export: it needs the Task ID and Name columns.');
  const custom = rows[0].map((h, i) => ({ h: h.trim(), i })).filter((x) => x.h && !CSV_KNOWN.has(lower(x.h)));
  const get = (r: string[], n: string) => (col(n) >= 0 ? s(r[col(n)]).trim() : '');
  const projName = (get(rows[1] || [], 'projects').split(',')[0] || '').trim() || fileName.replace(/\.csv$/i, '');
  const ref = 'csv:' + projName;
  const secs = new Map<string, ASection>();
  const all = new Map<string, ATask>();
  const parentOf = new Map<string, string>();
  const parentName = new Map<string, string>();
  const names = new Map<string, string>();
  for (const r of rows.slice(1)) {
    const gid = get(r, 'task id');
    if (!gid) continue;
    names.set(get(r, 'name'), gid);
  }
  for (const r of rows.slice(1)) {
    const gid = get(r, 'task id');
    if (!gid) continue;
    const sec = get(r, 'section/column');
    let section: ASection | null = null;
    if (sec && sec !== '(no section)') {
      if (!secs.has(sec)) secs.set(sec, { gid: `${ref}::${sec}`, name: sec });
      section = secs.get(sec)!;
    }
    const email = lower(get(r, 'assignee email'));
    const an = get(r, 'assignee');
    const completedAt = get(r, 'completed at');
    const t: ATask = {
      gid, name: get(r, 'name'), notes: get(r, 'notes'), completed: !!completedAt, completed_at: completedAt || null, completed_by: null,
      created_at: get(r, 'created at'), created_by: null, modified_at: get(r, 'last modified') || get(r, 'created at'),
      assignee: an || email ? { name: an, email } : null, start_on: day(get(r, 'start date')), start_at: null, due_on: day(get(r, 'due date')), due_at: null,
      section, parent: null, num_subtasks: 0, followers: [], tags: get(r, 'tags').split(',').map((x) => x.trim()).filter(Boolean),
      fields: custom.map((c) => ({ name: c.h, type: 'text', value: s(r[c.i]).trim(), people: [] })).filter((f) => f.value),
      other_projects: get(r, 'projects').split(',').map((x) => x.trim()).filter((x) => x && x !== projName), permalink: '',
      inline: { stories: [], attachments: [], deps: namesToIds(get(r, 'blocked by (dependencies)'), names, all) },
    };
    all.set(gid, t);
    const par = get(r, 'parent task');
    if (par) parentName.set(gid, par);
  }
  const top: ATask[] = [];
  for (const t of all.values()) {
    const pn = parentName.get(t.gid);
    const pg = pn ? names.get(pn) : '';
    const par = pg ? all.get(pg) : undefined;
    if (par) {
      t.parent = par.gid;
      parentOf.set(t.gid, par.gid);
      (par.inline!.subtasks ||= []).push(t);
      par.num_subtasks++;
    } else top.push(t);
  }
  const project: AProject = {
    gid: ref, name: projName, notes: '', archived: false, color: '', start_on: null, due_on: null, owner: null, members: [], sections: [...secs.values()],
    created_at: '', permalink: '', num_tasks: all.size,
  };
  return { project, tasks: top };
}

function taskFromJson(r: any, sec: ASection | null): ATask {
  const t = taskFromApi({ ...r, memberships: [] }, '');
  t.section = sec;
  t.fields = (Array.isArray(r.custom_fields) ? r.custom_fields : []).map((f: any) => ({
    name: s(f?.name).trim(), type: s(f?.type),
    value: s(f?.display_value ?? f?.text_value ?? f?.enum_value?.name ?? f?.number_value ?? f?.date_value?.date ?? '').trim(), people: users(f?.people_value),
  })).filter((f: AField) => f.name && (f.value || f.people.length));
  t.other_projects = [];
  const stories = (Array.isArray(r.stories) ? r.stories : []).filter((x: any) => (x.resource_subtype === 'comment_added' || x.type === 'comment') && s(x.text).trim());
  t.inline = {
    subtasks: (Array.isArray(r.subtasks) ? r.subtasks : []).map((x: any) => taskFromJson(x, sec)),
    stories: stories.map((x: any) => ({ gid: s(x.gid), created_at: s(x.created_at), author: asUser(x.created_by || x.author), text: s(x.text) })),
    attachments: (Array.isArray(r.attachments) ? r.attachments : []).map((a: any) => ({
      gid: s(a.gid), name: s(a.name) || 'attachment', host: lower(a.host) || 'asana', size: a.size != null && Number.isFinite(Number(a.size)) ? Number(a.size) : null,
      download_url: s(a.download_url), permanent_url: s(a.permanent_url || a.view_url), created_at: s(a.created_at),
    })),
    deps: (Array.isArray(r.dependencies) ? r.dependencies : []).map((d: any) => s(d?.gid ?? d)).filter(Boolean),
  };
  t.num_subtasks = t.inline.subtasks!.length;
  for (const sub of t.inline.subtasks!) sub.parent = t.gid;
  return t;
}

/** Asana's JSON export. Accepts {data:{...project, tasks:[...]}}, {data:[tasks]}, {tasks:[...]}, a bare list, or a list of projects. */
export function parseJsonExport(text: string, fileName = 'Asana export'): ExportedProject[] {
  let doc: any;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const body = doc && typeof doc === 'object' && 'data' in doc ? doc.data : doc;
  const projects: any[] = Array.isArray(body) && body.length && body.every((x: any) => x && Array.isArray(x.tasks)) ? body : [Array.isArray(body) ? { tasks: body } : body];
  const out: ExportedProject[] = [];
  projects.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const rawTasks: any[] = Array.isArray(p.tasks) ? p.tasks : [];
    const name = s(p.name).trim() || fileName.replace(/\.json$/i, '') || `Project ${i + 1}`;
    const gid = s(p.gid) || `json:${name}`;
    const secs = new Map<string, ASection>();
    const addSec = (x: any): ASection | null => {
      if (!x || !x.name) return null;
      const g = s(x.gid) || `${gid}::${x.name}`;
      if (!secs.has(g)) secs.set(g, { gid: g, name: s(x.name) });
      return secs.get(g)!;
    };
    for (const x of Array.isArray(p.sections) ? p.sections : []) addSec(x);
    const tasks: ATask[] = [];
    for (const r of rawTasks) {
      const m = (Array.isArray(r.memberships) ? r.memberships : []).find((mm: any) => !p.gid || s(mm?.project?.gid) === s(p.gid)) || (r.memberships || [])[0];
      const sec = addSec(m?.section) || addSec(r.section);
      if (r.parent && (r.parent.gid || typeof r.parent === 'string')) continue; // subtasks arrive inside their parent
      tasks.push(taskFromJson(r, sec));
    }
    const project: AProject = {
      gid, name, notes: s(p.notes), archived: !!p.archived, color: s(p.color), start_on: day(p.start_on), due_on: day(p.due_on), owner: asUser(p.owner),
      members: users(p.members), sections: [...secs.values()], created_at: s(p.created_at), permalink: s(p.permalink_url), num_tasks: rawTasks.length,
    };
    out.push({ project, tasks });
  });
  if (!out.length) throw new Error('No projects found in that file.');
  return out;
}

/** Reads text as either format. A file that starts with { or [ is JSON, anything else is CSV. */
export function parseExport(text: string, fileName = 'Asana export'): ExportedProject[] {
  const head = text.replace(/^﻿/, '').trimStart()[0];
  if (head === '{' || head === '[') return parseJsonExport(text, fileName);
  return [parseCsvExport(text, fileName)];
}

export class ExportSource implements Source {
  kind = 'export' as const;
  calls = 0;
  private list: ExportedProject[];
  private f: typeof fetch;
  constructor(list: ExportedProject[], f: typeof fetch = fetch) {
    this.list = list;
    this.f = f;
  }
  private find(ref: string) {
    const p = this.list.find((x) => x.project.gid === ref);
    if (!p) throw new Error(`The export has no project ${ref}.`);
    return p;
  }
  async projects(): Promise<AProjectLite[]> {
    return this.list.map((p) => ({ gid: p.project.gid, name: p.project.name, archived: p.project.archived, team: '', owner: p.project.owner?.name || '', color: p.project.color, tasks: p.project.num_tasks ?? p.tasks.length }));
  }
  async project(ref: string) {
    return this.find(ref).project;
  }
  async taskPage(ref: string, cursor: string | null) {
    const p = this.find(ref);
    const from = Number(cursor) || 0;
    const tasks = p.tasks.slice(from, from + 20);
    return { tasks, next: from + 20 < p.tasks.length ? String(from + 20) : null };
  }
  async subtasks(t: ATask) {
    return t.inline?.subtasks || [];
  }
  async stories(t: ATask) {
    return t.inline?.stories || [];
  }
  async attachments(t: ATask) {
    return t.inline?.attachments || [];
  }
  async dependencies(t: ATask) {
    return t.inline?.deps || [];
  }
  download(a: AAttachment, maxBytes: number) {
    return downloadFile(this.f, a, maxBytes);
  }
}
