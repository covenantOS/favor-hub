// The drawer's store and everything that changes it. One task is open at a time. The data (task, subtasks, comments, files, events,
// dependencies, followers, sections) lives in one mutable object `S`; every change calls bump(), and components read it through
// useDrawer(), which draws again on each bump (same pattern as TaskCtx). Ported from public/js/projects/drawer.js.
//
// Edits go through a TaskCtx exactly as before: the page's own context when the task is on the page, otherwise a second context of
// kind 'solo' that holds the task and its subtasks. Both update the screen first and roll back with a toast when the save fails.
import { useSyncExternalStore } from 'react';
import { api, type ApiError } from '../lib/api';
import { askText, choose, debounce } from '../kit/overlays';
import { askTime, pickCode, pickDate, pickOwner, pickPriority, pickSection, pickStatus, pickTask } from '../kit/pickers';
import { toast } from '../kit/toast';
import { getActiveStaff, type StaffDir } from '../lib/staff';
import { isTmp, TaskCtx } from '../lib/store';
import type { Person, Section, Task } from '../types';

/* ---------------------------------------------------------------- shapes of what /api/tasks/:id sends */
export interface DComment {
  id: string;
  task_id?: string;
  author_email: string;
  body: string;
  mentions?: string[];
  source?: string;
  created_at: string;
  deleted_at?: string | null;
  [k: string]: unknown;
}
export interface DFile {
  id: string;
  kind: string;
  name: string;
  url?: string;
  [k: string]: unknown;
}
export interface DEvent {
  id?: string;
  kind: string;
  actor_email?: string;
  detail?: unknown;
  created_at: string;
  [k: string]: unknown;
}
export interface Dep {
  id: string;
  code?: string | null;
  title: string;
  status: string;
}
export interface DrawerHooks {
  open?: (t: Task) => void;
  close?: (id: string | null) => void;
}

export interface DState {
  open: boolean;
  /** True once the drawer has been opened. The wrapper is drawn from then on, so it can fade out. */
  everOpened: boolean;
  id: string | null;
  task: Task | null;
  subtasks: Task[];
  comments: DComment[];
  files: DFile[];
  events: DEvent[];
  deps: { blockedBy: Dep[]; blocks: Dep[] };
  people: Person[];
  sections: Section[] | null;
  loaded: boolean;
  parentRef: Task | null;
  error: ApiError | null;
  token: number;
  main: TaskCtx | null;
  solo: TaskCtx | null;
  staff: StaffDir;
}

export const S: DState = {
  open: false,
  everOpened: false,
  id: null,
  task: null,
  subtasks: [],
  comments: [],
  files: [],
  events: [],
  deps: { blockedBy: [], blocks: [] },
  people: [],
  sections: null,
  loaded: false,
  parentRef: null,
  error: null,
  token: 0,
  main: null,
  solo: null,
  staff: getActiveStaff(),
};

let version = 0;
const listeners = new Set<() => void>();
export const bump = (): void => {
  version++;
  listeners.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const getVersion = () => version;
/** Draw again whenever the drawer's data changes. */
export function useDrawer(): DState {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return S;
}

let hooks: DrawerHooks = {};
export const setDrawerHooks = (h: DrawerHooks): void => {
  hooks = h || {};
};
export const drawerOpen = (): boolean => S.open;
export const currentTaskId = (): string | null => (S.open ? S.id : null);

let offs: (() => void)[] = [];
let tok: unknown = null;
let ret: HTMLElement | null = null;
let tokenSeq = 0;
const detach = () => {
  offs.forEach((f) => f());
  offs = [];
};

/** The fields in the panel that hold unsaved edits register here, so they are saved before the panel moves on. */
const flushers = new Set<() => void>();
export const registerFlush = (f: () => void): (() => void) => {
  flushers.add(f);
  return () => flushers.delete(f);
};
export function flush(): void {
  if (!S.open || !S.task) return;
  flushers.forEach((f) => f());
}

interface HubOv {
  on: (f: () => void) => unknown;
  off: (t: unknown) => void;
}
const hubOv = (): HubOv | undefined => (typeof window !== 'undefined' ? (window as unknown as { hubOv?: HubOv }).hubOv : undefined);

/* ---------------------------------------------------------------- links to a task */
/** The address of a task, as an absolute link. */
export function taskUrl(t: Pick<Task, 'id' | 'code' | 'project'>): string {
  const u = new URL(location.origin + '/projects/');
  if (t.project) {
    u.pathname = '/projects/p/';
    u.search = '?p=' + encodeURIComponent(t.project.key) + '&t=' + encodeURIComponent(t.code || t.id);
  } else u.search = '?t=' + encodeURIComponent(t.id);
  return u.toString();
}
/** The address a person copies: this page's own path with the task named. */
export function copyTaskLink(t: Pick<Task, 'id' | 'code' | 'project'>): void {
  const u = new URL(location.href);
  if (t.project) {
    u.pathname = u.pathname.replace(/\/projects\/?.*$/, '/projects/p/');
    u.search = '?p=' + encodeURIComponent(t.project.key) + '&t=' + encodeURIComponent(t.code || t.id);
  } else {
    u.search = '?t=' + encodeURIComponent(t.id);
  }
  const done = () => toast('Link copied');
  if (navigator.clipboard) navigator.clipboard.writeText(u.toString()).then(done, () => toast(u.toString()));
  else toast(u.toString());
}
export const projectUrl = (t: Pick<Task, 'id' | 'code' | 'project'>): string =>
  t.project && t.code ? '/projects/p/?p=' + encodeURIComponent(t.project.key) + '&t=' + encodeURIComponent(t.code) : '/projects/?t=' + encodeURIComponent(t.id);

/** A task as an item for the email composer (public/js/compose/compose.js). */
export function taskItem(t: Task) {
  const sub = [t.status ? String(t.status).replace(/_/g, ' ') : '', t.due_date ? 'due ' + t.due_date : ''].filter(Boolean).join(', ');
  return { kind: 'task', title: (t.code ? t.code + ' ' : '') + (t.title || 'Task'), url: taskUrl(t), sub };
}

/* ---------------------------------------------------------------- open and close */
export async function openDrawer(ctx: TaskCtx | null, ref: string, _opts?: Record<string, unknown>): Promise<void> {
  void _opts;
  if (typeof window === 'undefined' || !ref) return;
  const wasOpen = S.open;
  if (wasOpen) flush();
  const known = ctx ? ctx.by.get(ref) || [...ctx.by.values()].find((t) => t.code === ref) : undefined;
  if (!wasOpen) ret = document.activeElement as HTMLElement | null;
  detach();
  const token = ++tokenSeq;
  S.main = ctx;
  S.solo = null;
  S.staff = ctx ? ctx.staff : getActiveStaff();
  S.id = known ? known.id : ref;
  S.task = known || null;
  S.subtasks = [];
  S.comments = [];
  S.files = [];
  S.events = [];
  S.deps = { blockedBy: [], blocks: [] };
  S.people = [];
  S.loaded = false;
  S.parentRef = null;
  S.error = null;
  S.token = token;
  S.sections = ctx && ctx.sections && ctx.project && known && known.project_id === ctx.project.id ? ctx.sections : null;
  S.everOpened = true;
  if (!wasOpen) show();
  bump();
  try {
    const d = await api.task(ref);
    if (!S.open || S.token !== token) return;
    S.id = d.task.id;
    if (known && known.id === d.task.id) Object.assign(known, d.task);
    S.task = known && known.id === d.task.id ? known : d.task;
    S.subtasks = d.subtasks || [];
    S.comments = d.comments || [];
    S.files = d.files || [];
    S.events = d.events || [];
    S.deps = d.deps || { blockedBy: [], blocks: [] };
    S.people = d.people || [];
    S.loaded = true;
    const task = S.task as Task;
    const solo = new TaskCtx('solo', S.staff, { tasks: [task, ...S.subtasks], sections: ctx && ctx.sections ? ctx.sections : [], project: ctx ? ctx.project : null });
    S.solo = solo;
    offs.push(
      solo.on(() => {
        if (S.main && S.id && S.main.by.has(S.id)) S.main.emit('patch');
        bump();
      })
    );
    if (S.main) {
      const m = S.main;
      offs.push(
        m.on(() => {
          if (S.id) {
            const t = m.by.get(S.id);
            if (t) {
              S.task = t;
              if (solo.by.has(t.id)) solo.by.set(t.id, t);
            }
          }
          bump();
        })
      );
    }
    if (!S.sections && task.project_id) {
      api
        .project(task.project_id)
        .then((p) => {
          if (S.open && S.token === token) {
            S.sections = p.sections || [];
            solo.sections = S.sections;
            bump();
          }
        })
        .catch(() => undefined);
    }
    bump();
    if (hooks.open) hooks.open(task);
  } catch (e) {
    if (!S.open || S.token !== token) return;
    S.error = e as ApiError;
    bump();
  }
}

function show() {
  S.open = true;
  document.documentElement.classList.add('pj-dr-open');
  const ov = hubOv();
  if (ov && !tok) {
    tok = ov.on(() => {
      tok = null;
      close();
    });
  }
  window.addEventListener('keydown', gkey, true);
}
export function closeDrawer(): void {
  close();
}
function close() {
  if (!S.open) return;
  flush();
  S.open = false;
  document.documentElement.classList.remove('pj-dr-open');
  window.removeEventListener('keydown', gkey, true);
  const ov = hubOv();
  if (tok && ov) {
    const t = tok;
    tok = null;
    ov.off(t);
  }
  detach();
  const id = S.id;
  S.token = ++tokenSeq;
  bump();
  if (hooks.close) hooks.close(id);
  if (ret && ret.focus && document.contains(ret)) {
    try {
      ret.focus({ preventScroll: true });
    } catch {
      // gone
    }
  }
  const esc = (x: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(x) : x.replace(/[^\w-]/g, ''));
  const row = id && document.querySelector<HTMLElement>(`.pj-row[data-id="${esc(id)}"], .pj-card[data-id="${esc(id)}"]`);
  if (row && !ret) row.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------- saving */
const ctxFor = (id: string): TaskCtx | null => (S.main && S.main.by.has(id) ? S.main : S.solo);

/** Change fields on the open task. Resolves to true when it saved. */
export function upd(body: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<boolean> {
  if (!S.open || !S.task || !S.id) return Promise.resolve(false);
  const c = ctxFor(S.id);
  if (!c) return Promise.resolve(false);
  return c.patch(S.id, body, opts).then((ok) => {
    if (ok) refreshEvents();
    return ok;
  });
}
const refreshEvents = debounce(async () => {
  if (!S.open || !S.id) return;
  const id = S.id;
  try {
    const d = await api.task(id);
    if (!S.open || S.id !== id) return;
    S.events = d.events || [];
    // A comment still being sent stays on screen until the server confirms it.
    S.comments = d.comments ? [...d.comments, ...S.comments.filter((c) => isTmp(c.id))] : S.comments;
    bump();
  } catch {
    // the next change will try again
  }
}, 700);
export const reloadEvents = (): void => refreshEvents();

export function commitTitle(v: string): void {
  if (!S.open || !S.task) return;
  const t = v.trim();
  if (t && t !== S.task.title) void upd({ title: t });
}
export function commitDesc(v: string): void {
  if (!S.open || !S.task) return;
  if (v !== (S.task.description || '')) void upd({ description: v }, { quiet: false });
}

/** Tell the page's list the task changed (counts on rows, the check, the codes). */
const pingMain = () => {
  if (S.main) S.main.emit('patch');
};

/* ---------------------------------------------------------------- fields */
export async function pickField(k: string, anchor: HTMLElement, extra?: { kind?: string; field?: string; email?: string }): Promise<void> {
  if (!S.open || !S.task) return;
  const t = S.task;
  if (k === 'owner') {
    const r = await pickOwner({ title: 'Assign to', current: t.owner_email });
    if (r) void upd({ owner_email: r.email });
  } else if (k === 'due') {
    const v = await pickDate({ anchor, value: t.due_date, title: 'Due date' });
    if (v !== undefined) void upd(v ? { due_date: v } : { due_date: null, due_time: null });
  } else if (k === 'time-clear') void upd({ due_time: null });
  else if (k === 'time-add') {
    const v = await askTime();
    if (v) void upd({ due_time: v });
  } else if (k === 'due-clear') void upd({ due_date: null, due_time: null });
  else if (k === 'start') {
    const v = await pickDate({ anchor, value: t.start_date, title: 'Start date' });
    if (v !== undefined) void upd({ start_date: v });
  } else if (k === 'start-clear') void upd({ start_date: null });
  else if (k === 'priority') {
    const v = await pickPriority({ anchor, value: t.priority });
    if (v) void upd({ priority: v });
  } else if (k === 'status') {
    const v = await pickStatus({ anchor, value: t.status });
    if (!v || v === t.status) return;
    if (v === 'done') void upd({ done: true });
    else if (t.status === 'done') {
      await upd({ done: false });
      if (v !== 'open') void upd({ status: v });
    } else void upd({ status: v });
  } else if (k === 'section') {
    const secs = S.sections || (S.main && S.main.sections) || [];
    const v = await pickSection({ anchor, sections: secs, value: t.section_id });
    if (v !== undefined && (v || null) !== (t.section_id || null)) {
      const c = ctxFor(t.id);
      if (c) void c.move(t.id, { section_id: v });
    }
  } else if (k === 'waiting') {
    const r = await pickOwner({ title: 'Waiting on', current: t.waiting_on_email, clear: 'Nobody' });
    if (r) void upd({ waiting_on_email: r.email });
  } else if (k === 'waiting-clear') void upd({ waiting_on_email: null });
  else if (k === 'code') {
    const kind = extra?.kind || '';
    const field = extra?.field || '';
    const v = await pickCode({ anchor, kind, value: t[field] as string | null | undefined });
    if (v !== undefined) void upd({ [field]: v });
  } else if (k === 'follow') {
    const r = await pickOwner({ title: 'Add a follower', clear: '', exclude: [t.owner_email, ...S.people.map((p) => p.email)].filter(Boolean) });
    if (!r || !r.email) return;
    const email = r.email;
    const p = S.staff.personOf(email)!;
    S.people.push(p);
    bump();
    try {
      await api.people(t.id, { add: [{ email, role: 'follower' }] });
    } catch (err) {
      S.people = S.people.filter((x) => x.email !== email);
      bump();
      toast((err as Error).message, { error: true });
    }
  } else if (k === 'unfollow') {
    const email = extra?.email || '';
    const p = S.people.find((x) => x.email === email);
    if (!p) return;
    S.people = S.people.filter((x) => x.email !== email);
    bump();
    try {
      await api.people(t.id, { remove: [{ email, role: 'follower' }] });
    } catch (err) {
      S.people.push(p);
      bump();
      toast((err as Error).message, { error: true });
    }
  }
}

/* ---------------------------------------------------------------- subtasks */
export async function toggleSub(id: string): Promise<void> {
  const t = S.task;
  const s = S.subtasks.find((x) => x.id === id);
  if (!t || !s || !S.solo) return;
  await S.solo.patch(id, { done: s.status !== 'done' });
  const done = S.subtasks.filter((x) => x.status === 'done').length;
  t.subtasks = { done, total: S.subtasks.length };
  pingMain();
  bump();
}
export async function openSub(id: string): Promise<void> {
  const s = S.subtasks.find((x) => x.id === id);
  const parent = S.task;
  if (!s || !parent) return;
  await openDrawer(S.main, id);
  if (S.open && S.id === id) {
    S.parentRef = parent;
    bump();
  }
}
export async function addSub(title: string): Promise<void> {
  const t = S.task;
  const solo = S.solo;
  if (!t || !solo || !title) return;
  const tmp = { id: 'tmp-' + Math.random().toString(36).slice(2), title, status: 'open', parent_id: t.id, owner: null, pending: true, project_id: t.project_id, section_id: t.section_id, sort: 0, priority: 'normal' } as unknown as Task;
  S.subtasks.push(tmp);
  solo.tasks.push(tmp);
  solo.by.set(tmp.id, tmp);
  bump();
  try {
    const d = await api.createTask({ title, parent_id: t.id, project_id: t.project_id || undefined, section_id: t.section_id || undefined });
    solo.by.delete(tmp.id);
    Object.assign(tmp, d.task, { pending: false });
    solo.by.set(tmp.id, tmp);
    t.subtasks = { done: S.subtasks.filter((x) => x.status === 'done').length, total: S.subtasks.length };
    bump();
    pingMain();
  } catch (err) {
    const i = S.subtasks.indexOf(tmp);
    if (i >= 0) S.subtasks.splice(i, 1);
    const j = solo.tasks.indexOf(tmp);
    if (j >= 0) solo.tasks.splice(j, 1);
    solo.by.delete(tmp.id);
    bump();
    toast((err as Error).message + ' "' + title.slice(0, 40) + '" was removed.', { error: true });
  }
}

/* ---------------------------------------------------------------- dependencies */
export async function addDep(anchor: HTMLElement): Promise<void> {
  const t = S.task;
  if (!t) return;
  const r = await pickTask({ anchor, title: 'This task waits on', exclude: [t.id, ...(S.deps.blockedBy || []).map((d) => d.id)] });
  if (!r) return;
  const ref: Dep = { id: r.id, code: r.code, title: r.title, status: r.status };
  S.deps.blockedBy.push(ref);
  t.blocked = r.status !== 'done' || t.blocked;
  bump();
  pingMain();
  try {
    await api.deps(t.id, { add: [r.id] });
    refreshEvents();
  } catch (err) {
    const i = S.deps.blockedBy.indexOf(ref);
    if (i >= 0) S.deps.blockedBy.splice(i, 1);
    bump();
    toast((err as Error).message, { error: true });
  }
}
export async function removeDep(id: string): Promise<void> {
  const t = S.task;
  if (!t) return;
  const i = S.deps.blockedBy.findIndex((d) => d.id === id);
  if (i < 0) return;
  const [gone] = S.deps.blockedBy.splice(i, 1);
  bump();
  try {
    await api.deps(t.id, { remove: [id] });
  } catch (err) {
    S.deps.blockedBy.splice(i, 0, gone);
    bump();
    toast((err as Error).message, { error: true });
  }
}

/* ---------------------------------------------------------------- files */
export async function addFileLink(): Promise<void> {
  const t = S.task;
  if (!t) return;
  const url = await askText({ title: 'Add a link', label: 'Address', placeholder: 'https://', action: 'Add' });
  if (!url) return;
  const link = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const name = await askText({ title: 'Name the link', label: 'Name', value: link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), action: 'Add' });
  if (!name) return;
  try {
    const d = await api.addFile(t.id, { kind: 'link', name, url: link });
    S.files.push(d.file || { id: 'f' + Date.now(), kind: 'link', name, url: link });
    t.files = S.files.length;
    bump();
    pingMain();
  } catch (err) {
    toast((err as Error).message, { error: true });
  }
}
export async function removeFile(id: string): Promise<void> {
  const t = S.task;
  if (!t) return;
  const i = S.files.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [gone] = S.files.splice(i, 1);
  t.files = S.files.length;
  bump();
  pingMain();
  try {
    await api.deleteFile(t.id, id);
  } catch (err) {
    S.files.splice(i, 0, gone);
    t.files = S.files.length;
    bump();
    toast((err as Error).message, { error: true });
  }
}
export const MAX_UPLOAD = 25 * 1024 * 1024;
export async function uploadFiles(files: File[]): Promise<void> {
  const t = S.task;
  if (!t) return;
  for (const file of files) {
    if (file.size > MAX_UPLOAD) {
      toast(file.name + ' is over 25 MB.', { error: true });
      continue;
    }
    try {
      const d = await api.upload(t.id, file);
      S.files.push(d.file || { id: 'f' + Date.now(), kind: 'upload', name: file.name, url: '' });
      t.files = S.files.length;
      bump();
      pingMain();
    } catch (err) {
      toast((err as Error).message, { error: true });
    }
  }
}

/* ---------------------------------------------------------------- comments */
export async function sendComment(text: string, mentions: string[], afterAdd: () => void): Promise<void> {
  const t = S.task;
  if (!t || !S.id) return;
  const id = S.id;
  const tmp: DComment = { id: 'tmp-' + Math.random().toString(36).slice(2), task_id: id, author_email: S.staff.me, body: text, mentions, source: 'hub', created_at: new Date().toISOString() };
  S.comments.push(tmp);
  bump();
  afterAdd();
  try {
    const d = await api.comment(id, { body: text, mentions });
    if (d.comment) Object.assign(tmp, d.comment);
    t.comments = (t.comments || 0) + 1;
    bump();
    pingMain();
  } catch (e) {
    const i = S.comments.indexOf(tmp);
    if (i >= 0) S.comments.splice(i, 1);
    bump();
    toast((e as Error).message || 'The comment did not send.', { error: true });
    throw e;
  }
}
export async function deleteComment(id: string): Promise<void> {
  const t = S.task;
  const c = S.comments.find((x) => x.id === id);
  if (!t || !c) return;
  c.deleted_at = new Date().toISOString();
  bump();
  try {
    await api.deleteComment(t.id, id);
    t.comments = Math.max(0, (t.comments || 1) - 1);
    pingMain();
  } catch (err) {
    c.deleted_at = null;
    bump();
    toast((err as Error).message, { error: true });
  }
}

/* ---------------------------------------------------------------- the More menu */
interface Ix {
  findTime?: (o: { kind: string; ref: string }) => void;
  clipReply?: (o: { kind: string; ref: string; title: string }) => void;
}
interface Globals {
  FavorIx?: Ix;
  FavorCompose?: { add: (item: unknown) => void };
  FavorHandoff?: { open: (o: { kind: string; id: string; title: string }) => void };
}
export async function more(anchor: HTMLElement): Promise<void> {
  const t = S.task;
  if (!t) return;
  const g = window as unknown as Globals;
  const ix = g.FavorIx;
  const items: { value: string; label: string; icon: string }[] = [{ value: 'copy', label: 'Copy link', icon: 'copy' }];
  if (ix) items.push({ value: 'meet', label: 'Find a time', icon: 'clock' });
  if (ix && ix.clipReply) items.push({ value: 'clip', label: 'Reply with a clip', icon: 'send' });
  if (g.FavorCompose && document.documentElement.classList.contains('has-mail')) items.push({ value: 'email', label: 'Send to email', icon: 'send' });
  if (g.FavorHandoff) items.push({ value: 'handoff', label: 'Hand off', icon: 'user' });
  items.push({ value: 'del', label: 'Remove task', icon: 'trash' });
  const v = await choose<string>({ anchor, title: 'Task', items });
  if (v === 'meet' && ix && ix.findTime) ix.findTime({ kind: 'task', ref: t.id });
  if (v === 'clip' && ix && ix.clipReply) ix.clipReply({ kind: 'task', ref: t.id, title: t.title });
  if (v === 'copy') copyTaskLink(t);
  if (v === 'email' && g.FavorCompose) g.FavorCompose.add(taskItem(t));
  if (v === 'handoff' && g.FavorHandoff) g.FavorHandoff.open({ kind: 'task', id: t.id, title: t.title || '' });
  if (v === 'del') {
    const c = ctxFor(t.id);
    close();
    if (c && c === S.main) await S.main.remove([t.id]);
    else {
      try {
        await api.deleteTask(t.id);
        toast('Task removed');
      } catch (err) {
        toast((err as Error).message, { error: true });
      }
    }
  }
}

/* ---------------------------------------------------------------- moving between tasks */
export function orderIds(): string[] {
  const m = S.main;
  if (!m) return [];
  if (m.kind === 'project') {
    const out: string[] = [];
    for (const arr of m.grouped().values()) arr.forEach((t) => out.push(t.id));
    return out;
  }
  return m.tasks.filter((t) => m.matches(t)).map((t) => t.id);
}
export function stepTask(dir: number): void {
  if (!S.id) return;
  const ids = orderIds();
  const i = ids.indexOf(S.id);
  const n = ids[i + dir];
  if (n) {
    flush();
    void openDrawer(S.main, n);
  }
}
export function openParent(): void {
  if (S.task && S.task.parent_id) void openDrawer(S.main, S.task.parent_id);
}
export function retry(): void {
  if (S.id) void openDrawer(S.main, S.id);
}
export const toggleDone = (): void => {
  if (S.task) void upd({ done: S.task.status !== 'done' });
};

/* ---------------------------------------------------------------- keys (Escape, [ ], Space) */
function gkey(e: KeyboardEvent) {
  if (!S.open) return;
  const a = document.activeElement as HTMLElement | null;
  const typing = !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  if (e.key === 'Escape') {
    if (document.querySelector('.pj-sheet, .pj-pop, .rt-sheet, .ch-pop, .pjl-ov')) return;
    e.stopPropagation();
    e.preventDefault();
    close();
  } else if (!typing && (e.key === '[' || e.key === ']')) {
    e.preventDefault();
    stepTask(e.key === ']' ? 1 : -1);
  } else if (!typing && e.key === ' ' && S.task && a && !a.closest('button, a')) {
    e.preventDefault();
    toggleDone();
  }
}
