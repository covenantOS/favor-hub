// The task store. One TaskCtx holds a project's tasks (or the signed-in person's tasks, or one task and its subtasks) and every change
// goes through it: the screen updates first, the request follows, and a failure puts the row back and says why. Ported from
// public/js/projects/ui-data.js (Ctx) with the same behavior; React reads it through useCtx().
//
// The arrays and task objects are changed in place, as before. Every change calls emit(), which bumps `version`; a component that
// calls useCtx(ctx) draws again, and a row that wants to skip work compares its own signature (see taskSig in kit/rows.tsx).
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { addDays, todayStr } from './dates';
import { toast } from '../kit/toast';
import type { Dir, FilterState, Member, Project, Section, Task, TaskCounts, TasksPage } from '../types';
import type { StaffDir } from './staff';

const clone = (t: Task): Task => ({ ...t, owner: t.owner ? { ...t.owner } : t.owner, subtasks: t.subtasks ? { ...t.subtasks } : t.subtasks });
export const uid = (): string => 'tmp-' + Math.random().toString(36).slice(2, 10);
export const isTmp = (id: string | null | undefined): boolean => String(id || '').startsWith('tmp-');

export type Reader = (q: Record<string, unknown>) => Promise<{ tasks: Task[]; total?: number; counts?: TaskCounts; has_more?: boolean; next_offset?: number | null }>;

/** Reads every page of a task query (500 a page, following next_offset). Top-level tasks only. */
export async function fetchAllTasks(read: Reader, q: Record<string, unknown>): Promise<TasksPage> {
  const out: Task[] = [];
  let total = 0;
  let counts: TaskCounts | null = null;
  let off = 0;
  for (let i = 0; i < 40; i++) {
    const d = await read({ ...q, limit: 500, offset: off });
    out.push(...(d.tasks || []));
    total = d.total != null ? d.total : out.length;
    if (i === 0 && d.counts) counts = d.counts;
    const next = d.next_offset != null ? d.next_offset : d.has_more === undefined && d.tasks && d.tasks.length >= 500 && out.length < total ? out.length : null;
    if (next == null || !d.tasks || !d.tasks.length) break;
    off = next;
  }
  return { tasks: out.filter((t) => !t.parent_id), total, counts };
}

export interface CtxSeed {
  project?: Project | null;
  sections?: Section[];
  members?: Member[];
  canManage?: boolean;
  counts?: TaskCounts | null;
  tasks?: Task[];
  total?: number;
  showDone?: boolean;
}

export type SortBy = 'manual' | 'due' | 'owner' | 'title' | 'priority';

export class TaskCtx {
  kind: Dir;
  staff: StaffDir;
  project: Project | null = null;
  sections: Section[] = [];
  members: Member[] = [];
  canManage = false;
  tasks: Task[] = [];
  by = new Map<string, Task>();
  sel = new Set<string>();
  selecting = false;
  filter: FilterState = { q: '', owner: '', priority: '', due: '', status: '', code: '' };
  showDone: boolean;
  doneLoaded = false;
  keep = new Set<string>();
  counts: TaskCounts | null = null;
  projectCounts: TaskCounts | null = null;
  sort: { by: SortBy; dir: 1 | -1 } = { by: 'manual', dir: 1 };
  boardBy: 'section' | 'status' = 'section';
  pending = new Map<string, number>();
  chain: Promise<unknown> = Promise.resolve();
  total = 0;
  loading = false;
  error = '';
  status = 0;
  version = 0;
  private listeners = new Set<(what: string) => void>();
  private sectionTasks: Map<string, Task[]> | null = null;

  constructor(kind: Dir, staff: StaffDir, seed: CtxSeed = {}) {
    this.kind = kind;
    this.staff = staff;
    this.showDone = seed.showDone ?? kind === 'solo';
    this.project = seed.project ?? null;
    this.sections = seed.sections ?? [];
    this.members = seed.members ?? [];
    this.canManage = !!seed.canManage;
    this.counts = seed.counts ?? null;
    this.projectCounts = seed.counts ?? null;
    this.setTasks(seed.tasks ?? [], seed.total);
    this.doneLoaded = this.showDone;
  }

  /* --------- subscription (React reads these through useCtx) */
  subscribe = (fn: () => void): (() => void) => {
    const f = () => fn();
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  getVersion = (): number => this.version;
  /** Listen to named changes ('load', 'filter', 'patch', 'move', 'create', 'remove', 'sections', 'select', 'group', 'project'). */
  on(fn: (what: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(what = 'change'): void {
    this.sectionTasks = null;
    this.version++;
    for (const f of [...this.listeners]) f(what);
  }
  get me(): string {
    return this.staff.me;
  }

  setTasks(tasks: Task[], total?: number): void {
    this.tasks = tasks.slice();
    this.by = new Map(this.tasks.map((t) => [t.id, t]));
    this.total = total ?? tasks.length;
    this.sectionTasks = null;
  }

  /* --------- loading */
  private reader: Reader = (q) => api.tasks(q);
  async loadTasks(q: Record<string, unknown>): Promise<void> {
    const r = await fetchAllTasks(this.reader, q);
    this.setTasks(r.tasks, r.total);
    if (r.counts) this.counts = r.counts;
  }
  /** What the screen reads from the server: open tasks, or all of them once Show completed is on. */
  baseQuery(): Record<string, unknown> {
    if (this.kind === 'project') return { project: this.project ? this.project.id : '', status: this.showDone ? 'all' : 'open' };
    return { owner: 'me', status: this.showDone ? 'all' : 'open' };
  }
  /** Reads the project (sections, members, counts) and its tasks again. */
  async load(key?: string): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      if (this.kind === 'project') {
        const k = key || this.project?.key || '';
        const [d] = await Promise.all([api.project(k), this.loadTasks({ project: k, status: this.showDone ? 'all' : 'open' })]);
        this.project = d.project;
        this.sections = d.sections || [];
        this.members = d.members || [];
        this.projectCounts = d.counts || null;
        this.canManage = !!(d.can && d.can.manage);
        this.doneLoaded = this.showDone;
      } else {
        await this.loadTasks({ owner: 'me', status: this.showDone ? 'all' : 'open' });
      }
    } catch (e) {
      this.error = (e as Error).message || 'This did not load.';
      this.status = (e as { status?: number }).status || 0;
    }
    this.loading = false;
    this.emit('load');
  }
  /** Show or hide completed tasks. Turning it on reads them from the server the first time. */
  async setShowDone(on: boolean): Promise<void> {
    this.showDone = !!on;
    if (on && !this.doneLoaded) {
      this.loading = true;
      this.emit('load');
      try {
        const r = await fetchAllTasks(this.reader, { ...this.baseQuery(), status: 'done' });
        for (const t of r.tasks) if (!this.by.has(t.id)) { this.tasks.push(t); this.by.set(t.id, t); }
        this.doneLoaded = true;
      } catch (e) {
        this.showDone = false;
        toast((e as Error).message || 'Completed tasks did not load.', { error: true });
      }
      this.loading = false;
    }
    this.emit('filter');
  }
  /** The server renumbered a list: take every task's order and section from it, quietly. */
  async resyncOrder(): Promise<void> {
    try {
      const keep = this.tasks.slice();
      await this.loadTasks(this.baseQuery());
      const fresh = new Map(this.tasks.map((t) => [t.id, t]));
      this.tasks = keep.filter((t) => isTmp(t.id) || fresh.has(t.id));
      for (const t of this.tasks) {
        const f = fresh.get(t.id);
        if (f && !this.pending.has(t.id)) {
          t.sort = f.sort;
          t.section_id = f.section_id;
          t.section = f.section;
        }
      }
      this.by = new Map(this.tasks.map((t) => [t.id, t]));
      this.emit('move');
    } catch {
      // the next load will sort it out
    }
  }
  async reloadTasks(): Promise<void> {
    const keep = this.sel;
    try {
      await this.loadTasks(this.baseQuery());
      this.doneLoaded = this.showDone;
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
    this.sel = new Set([...keep].filter((id) => this.by.has(id)));
    this.emit('load');
  }

  /* --------- reading */
  sectionName(id: string | null | undefined): string | null {
    const s = this.sections.find((x) => x.id === id);
    return s ? s.name : null;
  }
  matches(t: Task): boolean {
    const f = this.filter;
    if (t.status === 'done' && !this.showDone && !this.keep.has(t.id)) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.due) {
      const today = todayStr();
      if (f.due === 'none') {
        if (t.due_date) return false;
      } else if (!t.due_date) return false;
      else if (f.due === 'overdue') {
        if (t.due_date >= today || t.status === 'done') return false;
      } else if (f.due === 'today') {
        if (t.due_date !== today) return false;
      } else if (f.due === 'week') {
        if (t.due_date < today || t.due_date > addDays(today, 7)) return false;
      }
    }
    if (f.code) {
      const c = f.code.toLowerCase();
      if (![t.appeal_code, t.source_code, t.fund_code, t.campaign_code].some((x) => x && String(x).toLowerCase() === c)) return false;
    }
    if (f.owner === 'none') {
      if (t.owner_email) return false;
    } else if (f.owner) {
      if (t.owner_email !== (f.owner === 'me' ? this.me : f.owner)) return false;
    }
    if (f.priority && t.priority !== f.priority) return false;
    if (f.q) {
      const h = (t.title + ' ' + (t.code || '') + ' ' + (t.appeal_code || '') + ' ' + (t.source_code || '') + ' ' + (t.fund_code || '') + ' ' + (t.campaign_code || '')).toLowerCase();
      for (const w of f.q.toLowerCase().split(/\s+/).filter(Boolean)) if (!h.includes(w)) return false;
    }
    return true;
  }
  /** Map of section id ('' for none) to its tasks, in the current order, after the filter. */
  grouped(): Map<string, Task[]> {
    if (this.sectionTasks) return this.sectionTasks;
    const m = new Map<string, Task[]>();
    for (const s of this.sections) m.set(s.id, []);
    m.set('', []);
    for (const t of this.tasks) {
      if (!this.matches(t)) continue;
      const k = t.section_id && m.has(t.section_id) ? t.section_id : '';
      m.get(k)!.push(t);
    }
    const { by, dir } = this.sort;
    const rank: Record<string, number> = { high: 0, normal: 1, low: 2 };
    const cmps: Record<SortBy, (a: Task, b: Task) => number> = {
      manual: (a, b) => a.sort - b.sort,
      due: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.sort - b.sort,
      owner: (a, b) => ((a.owner && a.owner.name) || '~').localeCompare((b.owner && b.owner.name) || '~') || a.sort - b.sort,
      title: (a, b) => a.title.localeCompare(b.title),
      priority: (a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || a.sort - b.sort,
    };
    const cmp = cmps[by] || cmps.manual;
    for (const arr of m.values()) arr.sort((a, b) => dir * cmp(a, b));
    this.sectionTasks = m;
    return m;
  }
  /** All tasks of one section regardless of the filter, in manual order (for working out a new sort value). */
  rawSection(sid: string | null | undefined): Task[] {
    return this.tasks.filter((t) => (t.section_id || '') === (sid || '')).sort((a, b) => a.sort - b.sort);
  }

  /* --------- changing */
  applyLocal(t: Task, body: Record<string, unknown>): void {
    for (const k of Object.keys(body)) {
      if (k === 'done') {
        t.status = body.done ? 'done' : 'open';
        t.done_at = body.done ? new Date().toISOString() : null;
        continue;
      }
      if (k === 'move') continue;
      (t as Record<string, unknown>)[k] = body[k];
    }
    if ('owner_email' in body) t.owner = body.owner_email ? this.staff.personOf(body.owner_email as string) : null;
    if ('section_id' in body) t.section = this.sectionName(body.section_id as string);
    if ('waiting_on_email' in body || 'waiting_on_task' in body) {
      if (t.waiting_on_email || t.waiting_on_task) t.status = 'waiting';
      else if (t.status === 'waiting') t.status = 'open';
    }
    t.overdue = !!(t.due_date && t.status !== 'done' && t.status !== 'dropped' && t.due_date < todayStr());
  }
  begin(id: string): void {
    this.pending.set(id, (this.pending.get(id) || 0) + 1);
  }
  end(id: string): number {
    const n = (this.pending.get(id) || 1) - 1;
    if (n <= 0) this.pending.delete(id);
    else this.pending.set(id, n);
    return n;
  }

  /** Change fields on one task. Returns true when it saved. */
  async patch(id: string, body: Record<string, unknown>, opts: { quiet?: boolean } = {}): Promise<boolean> {
    const t = this.by.get(id);
    if (!t || isTmp(id)) return false;
    const snap = clone(t);
    this.applyLocal(t, body);
    if (body.done && !this.showDone) this.keep.add(id);
    this.begin(id);
    this.emit('patch');
    try {
      const d = await api.patchTask(id, body);
      if (this.end(id) === 0 && d.task) Object.assign(t, d.task);
      this.emit('patch');
      return true;
    } catch (e) {
      this.end(id);
      Object.assign(t, snap);
      this.emit('patch');
      if (!opts.quiet) toast((e as Error).message || 'That did not save.', { error: true });
      return false;
    }
  }

  /** Put a task before or after another, in a section (or at the end). */
  async move(id: string, to: { section_id?: string | null; before?: string; after?: string; status?: string; done?: boolean }): Promise<boolean> {
    const t = this.by.get(id);
    if (!t || isTmp(id)) return false;
    const snap = clone(t);
    const sid = to.section_id === undefined ? t.section_id : to.section_id;
    const sib = this.rawSection(sid).filter((x) => x.id !== id);
    let i = sib.length;
    if (to.before) {
      const k = sib.findIndex((x) => x.id === to.before);
      if (k >= 0) i = k;
    } else if (to.after) {
      const k = sib.findIndex((x) => x.id === to.after);
      if (k >= 0) i = k + 1;
    }
    const prev = sib[i - 1];
    const next = sib[i];
    const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1000 : next ? next.sort - 1000 : 1000;
    t.sort = sort;
    if ((sid || null) !== (t.section_id || null)) {
      t.section_id = sid || null;
      t.section = this.sectionName(sid);
    }
    if (this.sort.by !== 'manual') this.sort = { by: 'manual', dir: 1 };
    this.begin(id);
    this.emit('move');
    try {
      const move: Record<string, unknown> = { section_id: sid || null };
      if (to.before) move.before = to.before;
      else if (to.after) move.after = to.after;
      const body: Record<string, unknown> = { move };
      if (to.status) body.status = to.status;
      if (to.done !== undefined) body.done = to.done;
      const d = await api.patchTask(id, body);
      let off = false;
      if (d.task) {
        const sv = Number(d.task.sort);
        off = !((!prev || sv > prev.sort) && (!next || sv < next.sort));
      }
      if (this.end(id) === 0 && d.task) Object.assign(t, d.task);
      this.emit('move');
      if (off) void this.resyncOrder();
      return true;
    } catch (e) {
      this.end(id);
      Object.assign(t, snap);
      this.emit('move');
      toast((e as Error).message || 'That move did not save.', { error: true });
      return false;
    }
  }

  /** Add a task at once and save it behind the scenes. Rows land in the order they were typed. */
  create(fields: Record<string, unknown> & { title?: string; section_id?: string | null; keep?: boolean }): Promise<Task | null> {
    const title = String(fields.title || '').trim();
    if (!title) return Promise.resolve(null);
    const sid = fields.section_id === undefined ? null : fields.section_id;
    const sib = this.rawSection(sid);
    const tmp = {
      id: uid(),
      project_id: this.project ? this.project.id : (fields.project_id as string) || null,
      section_id: sid,
      section: this.sectionName(sid),
      code: null,
      title,
      description: '',
      status: 'open',
      priority: 'normal',
      owner_email: (fields.owner_email as string) || null,
      owner: fields.owner_email ? this.staff.personOf(fields.owner_email as string) : null,
      start_date: null,
      due_date: (fields.due_date as string) || null,
      due_time: null,
      parent_id: null,
      sort: (sib.length ? sib[sib.length - 1].sort : 0) + 1000,
      appeal_code: null,
      source_code: null,
      fund_code: null,
      campaign_code: null,
      project: this.project ? { id: this.project.id, key: this.project.key, name: this.project.name, color: this.project.color } : null,
      subtasks: { done: 0, total: 0 },
      comments: 0,
      files: 0,
      overdue: false,
      blocked: false,
      pending: true,
      created_at: new Date().toISOString(),
      ...Object.fromEntries(['appeal_code', 'source_code', 'fund_code', 'campaign_code', 'priority', 'start_date'].filter((k) => fields[k]).map((k) => [k, fields[k]])),
    } as Task;
    if (this.kind === 'project' || fields.keep !== false) {
      this.tasks.push(tmp);
      this.by.set(tmp.id, tmp);
    }
    this.emit('create');
    const body: Record<string, unknown> = { title, project_id: tmp.project_id || undefined, section_id: sid || undefined };
    for (const k of ['owner_email', 'due_date', 'start_date', 'priority', 'description', 'appeal_code', 'source_code', 'fund_code', 'campaign_code']) if (fields[k]) body[k] = fields[k];
    const run = async (): Promise<Task | null> => {
      try {
        const d = await api.createTask(body);
        const real = d.task;
        const live = this.by.get(tmp.id);
        if (live) {
          this.by.delete(tmp.id);
          const edits: Record<string, unknown> = {};
          for (const k of ['title', 'owner_email', 'due_date', 'priority', 'status', 'section_id'] as const) if (live[k] !== tmp[k]) edits[k] = live[k];
          Object.assign(live, real, { pending: false });
          this.by.set(live.id, live);
          if (this.sel.has(tmp.id)) {
            this.sel.delete(tmp.id);
            this.sel.add(live.id);
          }
          this.emit('created');
          if (Object.keys(edits).length) void this.patch(live.id, edits, { quiet: true });
          return live;
        }
        return real;
      } catch (e) {
        const live = this.by.get(tmp.id);
        if (live) {
          this.tasks.splice(this.tasks.indexOf(live), 1);
          this.by.delete(tmp.id);
          this.sel.delete(tmp.id);
          this.emit('create');
        }
        toast(((e as Error).message || 'That did not save.') + ' "' + title.slice(0, 40) + '" was removed.', { error: true });
        return null;
      }
    };
    const p = this.chain.then(run, run) as Promise<Task | null>;
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** Remove tasks (they become Dropped on the server) with an undo. */
  async remove(ids: string[]): Promise<void> {
    const gone = ids.map((id) => this.by.get(id)).filter(Boolean) as Task[];
    if (!gone.length) return;
    const snaps = gone.map(clone);
    for (const t of gone) {
      this.tasks.splice(this.tasks.indexOf(t), 1);
      this.by.delete(t.id);
      this.sel.delete(t.id);
    }
    this.emit('remove');
    const results = await Promise.allSettled(gone.map((t) => (isTmp(t.id) ? Promise.resolve() : api.deleteTask(t.id))));
    const failed = snaps.filter((_, i) => results[i].status === 'rejected');
    if (failed.length) {
      for (const s of failed) {
        this.tasks.push(s);
        this.by.set(s.id, s);
      }
      this.emit('remove');
      const first = results[snaps.indexOf(failed[0])] as PromiseRejectedResult;
      toast(failed.length === 1 ? (first.reason as Error).message || 'That was not removed.' : failed.length + ' tasks could not be removed.', { error: true });
    }
    const okSnaps = snaps.filter((s) => !failed.includes(s));
    if (okSnaps.length) {
      toast(okSnaps.length === 1 ? 'Task removed' : okSnaps.length + ' tasks removed', {
        undo: async () => {
          for (const s of okSnaps) {
            this.tasks.push(s);
            this.by.set(s.id, s);
          }
          this.emit('remove');
          await Promise.allSettled(okSnaps.map((s) => api.patchTask(s.id, { status: s.status === 'dropped' ? 'open' : s.status })));
        },
      });
    }
  }

  async bulk(ids: string[], body: Record<string, unknown>): Promise<boolean> {
    const res = await Promise.all(ids.map((id) => this.patch(id, body, { quiet: true })));
    const bad = res.filter((x) => !x).length;
    if (bad) toast(bad === 1 ? 'One task did not save.' : bad + ' tasks did not save.', { error: true });
    return !bad;
  }

  /* --------- sections */
  async addSection(name: string): Promise<Section | null> {
    name = String(name || '').trim();
    if (!name || !this.project) return null;
    const tmp: Section = { id: uid(), project_id: this.project.id, name, sort: (this.sections.length ? this.sections[this.sections.length - 1].sort : 0) + 1000 };
    this.sections.push(tmp);
    this.emit('sections');
    try {
      const d = await api.createSection(this.project.id, { name });
      Object.assign(tmp, d.section);
      this.emit('sections');
      return tmp;
    } catch (e) {
      this.sections.splice(this.sections.indexOf(tmp), 1);
      this.emit('sections');
      toast((e as Error).message, { error: true });
      return null;
    }
  }
  async renameSection(sid: string, name: string): Promise<void> {
    const s = this.sections.find((x) => x.id === sid);
    name = String(name || '').trim();
    if (!s || !name || name === s.name || !this.project) return;
    const old = s.name;
    s.name = name;
    for (const t of this.tasks) if (t.section_id === sid) t.section = name;
    this.emit('sections');
    try {
      await api.patchSection(this.project.id, sid, { name });
    } catch (e) {
      s.name = old;
      for (const t of this.tasks) if (t.section_id === sid) t.section = old;
      this.emit('sections');
      toast((e as Error).message, { error: true });
    }
  }
  async deleteSection(sid: string): Promise<void> {
    const i = this.sections.findIndex((x) => x.id === sid);
    if (i < 0 || !this.project) return;
    const s = this.sections[i];
    const moved = this.tasks.filter((t) => t.section_id === sid);
    this.sections.splice(i, 1);
    moved.forEach((t) => {
      t.section_id = null;
      t.section = null;
    });
    this.emit('sections');
    try {
      await api.deleteSection(this.project.id, sid);
    } catch (e) {
      this.sections.splice(i, 0, s);
      moved.forEach((t) => {
        t.section_id = sid;
        t.section = s.name;
      });
      this.emit('sections');
      toast((e as Error).message, { error: true });
    }
  }
  async moveSection(sid: string, dir: number): Promise<void> {
    const i = this.sections.findIndex((x) => x.id === sid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.sections.length || !this.project) return;
    const a = this.sections[i];
    const b = this.sections[j];
    const was: [number, number] = [a.sort, b.sort];
    [a.sort, b.sort] = [b.sort, a.sort];
    this.sections.sort((x, y) => x.sort - y.sort);
    this.emit('sections');
    try {
      await Promise.all([api.patchSection(this.project.id, a.id, { sort: a.sort }), api.patchSection(this.project.id, b.id, { sort: b.sort })]);
    } catch (e) {
      [a.sort, b.sort] = was;
      this.sections.sort((x, y) => x.sort - y.sort);
      this.emit('sections');
      toast((e as Error).message, { error: true });
    }
  }
}

/** Draw again whenever the store changes. Returns the version, so a memo can depend on it. */
export function useCtx(ctx: TaskCtx): number {
  return useSyncExternalStore(ctx.subscribe, ctx.getVersion, ctx.getVersion);
}
