/* Data layer for the projects UI. One Ctx holds a project's tasks (or the signed-in person's tasks) and every change goes through it:
   the screen updates first, the request follows, and a failure puts the row back and says why. */
import { toast, todayStr, uid } from './ui-util.js';

import { api as core } from './api.js';

/* The client for /api/projects and /api/tasks is lane CORE's api.js (it also answers from its fixture with ?mock=1). The names below are the
   ones this UI uses; each maps to one function there. Every call throws an Error with a message that is safe to show and a .status. */
export const api = {
  projects: () => core.projects(),
  project: (id) => core.project(id),
  createProject: (b) => core.createProject(b),
  patchProject: (id, b) => core.patchProject(id, b),
  addSection: (pid, b) => core.createSection(pid, b),
  patchSection: (pid, sid, b) => core.patchSection(pid, sid, b),
  deleteSection: (pid, sid) => core.deleteSection(pid, sid),
  members: (pid, b) => core.members(pid, b),
  tasks: (q) => core.tasks(q),
  task: (id) => core.task(id),
  createTask: (b) => core.createTask(b),
  patchTask: (id, b) => core.patchTask(id, b),
  deleteTask: (id) => core.deleteTask(id),
  comment: (id, b) => core.comment(id, b),
  deleteComment: (id, cid) => core.deleteComment(id, cid),
  addFile: (id, b) => core.addFile(id, b),
  deleteFile: (id, fid) => core.deleteFile(id, fid),
  upload: (id, file) => core.upload(id, file),
  people: (id, b) => core.people(id, b),
  deps: (id, b) => core.deps(id, b),
  codes: (kind, q) => core.codes(kind, q),
  staff: () => core.directory(),
};

/* ---------------------------------------------------------------- staff */
export const Staff = { list: [], by: new Map(), me: '', loaded: null };
export function loadStaff() {
  if (!Staff.loaded) {
    Staff.loaded = api.staff().then((d) => {
      Staff.list = d.people || [];
      Staff.me = d.me || '';
      Staff.by = new Map(Staff.list.map((p) => [p.email, p]));
      return Staff;
    }).catch(() => { Staff.loaded = null; return Staff; });
  }
  return Staff.loaded;
}
export const personOf = (email) => {
  if (!email) return null;
  const p = Staff.by.get(String(email).toLowerCase());
  return p ? { email: p.email, name: p.name, picture: p.picture || '' } : { email, name: String(email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), picture: '' };
};

/* ---------------------------------------------------------------- codes (cached) */
const codeCache = new Map();
export function codes(kind, q) {
  const key = kind + '|' + (q || '').toLowerCase();
  if (!codeCache.has(key)) codeCache.set(key, api.codes(kind, q || '').then((d) => d.codes || []).catch((e) => { codeCache.delete(key); throw e; }));
  return codeCache.get(key);
}
export const CODE_KINDS = [
  { kind: 'appeal', field: 'appeal_code', label: 'Appeal' },
  { kind: 'source', field: 'source_code', label: 'Source' },
  { kind: 'fund', field: 'fund_code', label: 'Fund' },
  { kind: 'campaign', field: 'campaign_code', label: 'Campaign' },
];

/* ---------------------------------------------------------------- the task store */
const clone = (t) => ({ ...t, owner: t.owner ? { ...t.owner } : t.owner, subtasks: t.subtasks ? { ...t.subtasks } : t.subtasks });

export class Ctx {
  /** kind: 'project' (a project's tasks) or 'mine' (the signed-in person's tasks, any project). */
  constructor(kind) {
    this.kind = kind;
    this.project = null;
    this.sections = [];
    this.members = [];
    this.tasks = [];
    this.by = new Map();
    this.sel = new Set();
    this.filter = { q: '', owner: '', hideDone: false, priority: '' };
    this.sort = { by: 'manual', dir: 1 };
    this.listeners = new Set();
    this.pending = new Map();
    this.chain = Promise.resolve();
    this.total = 0;
    this.loading = true;
    this.error = '';
    this.sectionTasks = null;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) {
    this.sectionTasks = null;
    for (const f of [...this.listeners]) f(what || 'change');
    if (this.kind !== 'solo') window.dispatchEvent(new CustomEvent('pj:change', { detail: { ctx: this, what: what || 'change' } }));
  }
  get me() { return Staff.me; }

  async load(key) {
    this.loading = true; this.error = '';
    try {
      await loadStaff();
      if (this.kind === 'project') {
        const d = await api.project(key);
        this.project = d.project; this.sections = d.sections || []; this.members = d.members || []; this.counts = d.counts || {};
        await this.loadTasks({ project: this.project.id, status: 'all' });
      } else {
        await this.loadTasks({ owner: 'me', status: this.showDone ? 'all' : 'open' });
      }
    } catch (e) {
      this.error = e.message || 'This did not load.';
      this.status = e.status || 0;
    }
    this.loading = false;
    this.emit('load');
  }
  async loadTasks(q) {
    const out = [];
    let total = 0;
    for (let off = 0; off < 5000; off += 500) {
      const d = await api.tasks({ ...q, limit: 500, offset: off });
      out.push(...(d.tasks || []));
      total = d.total != null ? d.total : out.length;
      if (!d.tasks || d.tasks.length < 500 || out.length >= total) break;
    }
    this.tasks = out.filter((t) => !t.parent_id);
    this.by = new Map(this.tasks.map((t) => [t.id, t]));
    this.total = total;
  }
  /** The server renumbered a list: take every task's order and section from it, quietly. */
  async resyncOrder() {
    try {
      const keep = this.tasks.slice();
      const q = this.kind === 'project' ? { project: this.project.id, status: 'all' } : { owner: 'me', status: this.showDone ? 'all' : 'open' };
      await this.loadTasks(q);
      const fresh = new Map(this.tasks.map((t) => [t.id, t]));
      this.tasks = keep.filter((t) => String(t.id).startsWith('tmp-') || fresh.has(t.id));
      for (const t of this.tasks) { const f = fresh.get(t.id); if (f && !this.pending.has(t.id)) { t.sort = f.sort; t.section_id = f.section_id; t.section = f.section; } }
      this.by = new Map(this.tasks.map((t) => [t.id, t]));
      this.emit('move');
    } catch (_) { /* the next load will sort it out */ }
  }
  async reloadTasks() {
    const keep = this.sel;
    try {
      if (this.kind === 'project') await this.loadTasks({ project: this.project.id, status: 'all' });
      else await this.loadTasks({ owner: 'me', status: this.showDone ? 'all' : 'open' });
    } catch (e) { toast(e.message, { error: true }); }
    this.sel = new Set([...keep].filter((id) => this.by.has(id)));
    this.emit('load');
  }

  /* --------- reading */
  sectionName(id) { const s = this.sections.find((x) => x.id === id); return s ? s.name : null; }
  matches(t) {
    const f = this.filter;
    if (f.hideDone && t.status === 'done') return false;
    if (f.owner === 'none') { if (t.owner_email) return false; } else if (f.owner) { if (t.owner_email !== (f.owner === 'me' ? this.me : f.owner)) return false; }
    if (f.priority && t.priority !== f.priority) return false;
    if (f.q) { const h = (t.title + ' ' + (t.code || '') + ' ' + (t.appeal_code || '') + ' ' + (t.source_code || '') + ' ' + (t.fund_code || '') + ' ' + (t.campaign_code || '')).toLowerCase(); for (const w of f.q.toLowerCase().split(/\s+/).filter(Boolean)) if (!h.includes(w)) return false; }
    return true;
  }
  /** Map of section id ('' for none) to its tasks, in the current order, after the filter. */
  grouped() {
    if (this.sectionTasks) return this.sectionTasks;
    const m = new Map();
    for (const s of this.sections) m.set(s.id, []);
    m.set('', []);
    for (const t of this.tasks) {
      if (!this.matches(t)) continue;
      const k = t.section_id && m.has(t.section_id) ? t.section_id : '';
      m.get(k).push(t);
    }
    const { by, dir } = this.sort;
    const cmp = {
      manual: (a, b) => a.sort - b.sort,
      due: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.sort - b.sort,
      owner: (a, b) => ((a.owner && a.owner.name) || '~').localeCompare((b.owner && b.owner.name) || '~') || a.sort - b.sort,
      title: (a, b) => a.title.localeCompare(b.title),
      priority: (a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority]) || a.sort - b.sort,
    }[by] || ((a, b) => a.sort - b.sort);
    for (const arr of m.values()) arr.sort((a, b) => dir * cmp(a, b));
    this.sectionTasks = m;
    return m;
  }
  /** All tasks of one section regardless of the filter, in manual order (for working out a new sort value). */
  rawSection(sid) { return this.tasks.filter((t) => (t.section_id || '') === (sid || '')).sort((a, b) => a.sort - b.sort); }

  /* --------- changing */
  applyLocal(t, body) {
    for (const k of Object.keys(body)) {
      if (k === 'done') { t.status = body.done ? 'done' : 'open'; t.done_at = body.done ? new Date().toISOString() : null; continue; }
      if (k === 'move') continue;
      t[k] = body[k];
    }
    if ('owner_email' in body) t.owner = body.owner_email ? personOf(body.owner_email) : null;
    if ('section_id' in body) t.section = this.sectionName(body.section_id);
    if ('waiting_on_email' in body || 'waiting_on_task' in body) { if (t.waiting_on_email || t.waiting_on_task) t.status = 'waiting'; else if (t.status === 'waiting') t.status = 'open'; }
    t.overdue = !!(t.due_date && t.status !== 'done' && t.status !== 'dropped' && t.due_date < todayStr());
  }
  begin(id) { this.pending.set(id, (this.pending.get(id) || 0) + 1); }
  end(id) { const n = (this.pending.get(id) || 1) - 1; if (n <= 0) this.pending.delete(id); else this.pending.set(id, n); return n; }

  /** Change fields on one task. Returns true when it saved. */
  async patch(id, body, opts = {}) {
    const t = this.by.get(id);
    if (!t || String(id).startsWith('tmp-')) return false;
    const snap = clone(t);
    this.applyLocal(t, body);
    this.begin(id);
    this.emit('patch');
    try {
      const d = await api.patchTask(id, body);
      if (this.end(id) === 0 && d.task) { Object.assign(t, d.task); }
      this.emit('patch');
      return true;
    } catch (e) {
      this.end(id);
      Object.assign(t, snap);
      this.emit('patch');
      if (!opts.quiet) toast(e.message || 'That did not save.', { error: true });
      return false;
    }
  }

  /** Put a task before or after another, in a section (or at the end). */
  async move(id, to) {
    const t = this.by.get(id);
    if (!t || String(id).startsWith('tmp-')) return false;
    const snap = clone(t);
    const sid = to.section_id === undefined ? t.section_id : to.section_id;
    const sib = this.rawSection(sid).filter((x) => x.id !== id);
    let i = sib.length;
    if (to.before) { const k = sib.findIndex((x) => x.id === to.before); if (k >= 0) i = k; } else if (to.after) { const k = sib.findIndex((x) => x.id === to.after); if (k >= 0) i = k + 1; }
    const prev = sib[i - 1], next = sib[i];
    const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1000 : next ? next.sort - 1000 : 1000;
    t.sort = sort;
    if ((sid || null) !== (t.section_id || null)) { t.section_id = sid || null; t.section = this.sectionName(sid); }
    if (this.sort.by !== 'manual') this.sort = { by: 'manual', dir: 1 };
    this.begin(id);
    this.emit('move');
    try {
      const move = { section_id: sid || null };
      if (to.before) move.before = to.before; else if (to.after) move.after = to.after;
      const body = { move };
      if (to.status) body.status = to.status;
      if (to.done !== undefined) body.done = to.done;
      const d = await api.patchTask(id, body);
      let off = false;
      if (d.task) { const sv = Number(d.task.sort); off = !((!prev || sv > prev.sort) && (!next || sv < next.sort)); }
      if (this.end(id) === 0 && d.task) Object.assign(t, d.task);
      this.emit('move');
      if (off) this.resyncOrder();
      return true;
    } catch (e) {
      this.end(id);
      Object.assign(t, snap);
      this.emit('move');
      toast(e.message || 'That move did not save.', { error: true });
      return false;
    }
  }

  /** Add a task at once and save it behind the scenes. Rows land in the order they were typed. */
  create(fields) {
    const title = String(fields.title || '').trim();
    if (!title) return Promise.resolve(null);
    const sid = fields.section_id === undefined ? null : fields.section_id;
    const sib = this.rawSection(sid);
    const tmp = {
      id: uid(), project_id: this.project ? this.project.id : (fields.project_id || null), section_id: sid, section: this.sectionName(sid), code: null, title, description: '', status: 'open', priority: 'normal',
      owner_email: fields.owner_email || null, owner: fields.owner_email ? personOf(fields.owner_email) : null, start_date: null, due_date: fields.due_date || null, due_time: null,
      parent_id: null, sort: (sib.length ? sib[sib.length - 1].sort : 0) + 1000, appeal_code: null, source_code: null, fund_code: null, campaign_code: null,
      project: this.project ? { id: this.project.id, key: this.project.key, name: this.project.name, color: this.project.color } : null,
      subtasks: { done: 0, total: 0 }, comments: 0, files: 0, overdue: false, blocked: false, pending: true, created_at: new Date().toISOString(),
      ...Object.fromEntries(['appeal_code', 'source_code', 'fund_code', 'campaign_code', 'priority', 'start_date'].filter((k) => fields[k]).map((k) => [k, fields[k]])),
    };
    if (this.kind === 'project' || fields.keep !== false) { this.tasks.push(tmp); this.by.set(tmp.id, tmp); }
    this.emit('create');
    const body = { title, project_id: tmp.project_id || undefined, section_id: sid || undefined };
    for (const k of ['owner_email', 'due_date', 'start_date', 'priority', 'description', 'appeal_code', 'source_code', 'fund_code', 'campaign_code']) if (fields[k]) body[k] = fields[k];
    const run = async () => {
      try {
        const d = await api.createTask(body);
        const real = d.task;
        const live = this.by.get(tmp.id);
        if (live) {
          this.by.delete(tmp.id);
          const edits = {};
          for (const k of ['title', 'owner_email', 'due_date', 'priority', 'status', 'section_id']) if (live[k] !== tmp[k]) edits[k] = live[k];
          Object.assign(live, real, { pending: false });
          this.by.set(live.id, live);
          if (this.sel.has(tmp.id)) { this.sel.delete(tmp.id); this.sel.add(live.id); }
          this.emit('created');
          if (Object.keys(edits).length) this.patch(live.id, edits, { quiet: true });
          return live;
        }
        return real;
      } catch (e) {
        const live = this.by.get(tmp.id);
        if (live) { this.tasks.splice(this.tasks.indexOf(live), 1); this.by.delete(tmp.id); this.sel.delete(tmp.id); this.emit('create'); }
        toast((e.message || 'That did not save.') + ' "' + title.slice(0, 40) + '" was removed.', { error: true });
        return null;
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /** Remove tasks (they become Dropped on the server) with an undo. */
  async remove(ids) {
    const gone = ids.map((id) => this.by.get(id)).filter(Boolean);
    if (!gone.length) return;
    const snaps = gone.map(clone);
    for (const t of gone) { this.tasks.splice(this.tasks.indexOf(t), 1); this.by.delete(t.id); this.sel.delete(t.id); }
    this.emit('remove');
    const results = await Promise.allSettled(gone.map((t) => (String(t.id).startsWith('tmp-') ? Promise.resolve() : api.deleteTask(t.id))));
    const failed = snaps.filter((_, i) => results[i].status === 'rejected');
    if (failed.length) {
      for (const s of failed) { this.tasks.push(s); this.by.set(s.id, s); }
      this.emit('remove');
      toast(failed.length === 1 ? (results[snaps.indexOf(failed[0])].reason.message || 'That was not removed.') : failed.length + ' tasks could not be removed.', { error: true });
    }
    const okSnaps = snaps.filter((s) => !failed.includes(s));
    if (okSnaps.length) {
      toast(okSnaps.length === 1 ? 'Task removed' : okSnaps.length + ' tasks removed', {
        undo: async () => {
          for (const s of okSnaps) { this.tasks.push(s); this.by.set(s.id, s); }
          this.emit('remove');
          await Promise.allSettled(okSnaps.map((s) => api.patchTask(s.id, { status: s.status === 'dropped' ? 'open' : s.status })));
        },
      });
    }
  }

  async bulk(ids, body) {
    const res = await Promise.all(ids.map((id) => this.patch(id, body, { quiet: true })));
    const bad = res.filter((x) => !x).length;
    if (bad) toast(bad === 1 ? 'One task did not save.' : bad + ' tasks did not save.', { error: true });
    return !bad;
  }

  /* --------- sections */
  async addSection(name) {
    name = String(name || '').trim();
    if (!name || !this.project) return null;
    const tmp = { id: uid(), project_id: this.project.id, name, sort: (this.sections.length ? this.sections[this.sections.length - 1].sort : 0) + 1000 };
    this.sections.push(tmp);
    this.emit('sections');
    try {
      const d = await api.addSection(this.project.id, { name });
      Object.assign(tmp, d.section);
      this.emit('sections');
      return tmp;
    } catch (e) {
      this.sections.splice(this.sections.indexOf(tmp), 1);
      this.emit('sections');
      toast(e.message, { error: true });
      return null;
    }
  }
  async renameSection(sid, name) {
    const s = this.sections.find((x) => x.id === sid);
    name = String(name || '').trim();
    if (!s || !name || name === s.name) return;
    const old = s.name;
    s.name = name;
    for (const t of this.tasks) if (t.section_id === sid) t.section = name;
    this.emit('sections');
    try { await api.patchSection(this.project.id, sid, { name }); } catch (e) { s.name = old; for (const t of this.tasks) if (t.section_id === sid) t.section = old; this.emit('sections'); toast(e.message, { error: true }); }
  }
  async deleteSection(sid) {
    const i = this.sections.findIndex((x) => x.id === sid);
    if (i < 0) return;
    const s = this.sections[i];
    const moved = this.tasks.filter((t) => t.section_id === sid);
    this.sections.splice(i, 1);
    moved.forEach((t) => { t.section_id = null; t.section = null; });
    this.emit('sections');
    try { await api.deleteSection(this.project.id, sid); } catch (e) {
      this.sections.splice(i, 0, s);
      moved.forEach((t) => { t.section_id = sid; t.section = s.name; });
      this.emit('sections');
      toast(e.message, { error: true });
    }
  }
  async moveSection(sid, dir) {
    const i = this.sections.findIndex((x) => x.id === sid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.sections.length) return;
    const a = this.sections[i], b = this.sections[j];
    const was = [a.sort, b.sort];
    [a.sort, b.sort] = [b.sort, a.sort];
    this.sections.sort((x, y) => x.sort - y.sort);
    this.emit('sections');
    try { await Promise.all([api.patchSection(this.project.id, a.id, { sort: a.sort }), api.patchSection(this.project.id, b.id, { sort: b.sort })]); } catch (e) {
      [a.sort, b.sort] = was; this.sections.sort((x, y) => x.sort - y.sort); this.emit('sections'); toast(e.message, { error: true });
    }
  }
}
