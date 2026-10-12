// Onboarding and offboarding runs. A run is one person's start or exit: a checklist generated from the template, each step with
// an owner and a due date counted from the start date (or the last day), and each person-step as a task in Projects.
//   hub admins and people marked HR   everything
//   a step's owner                    marks that step done or open again
//   the supervisor                    reads the run and marks their steps
// FavorOS does its own steps (add the person, close access, hand over open work) only when an admin presses the button.
import { HttpError, newId, nowIso, type Env } from '../http';
import { staffDirectory, type Person } from '../people';
import { allReporting, isHr, reportingOf, supervisorOf } from '../people-dev';
import { joinDefaults } from '../chat/db';
import { DEFAULTS, DUTIES, GROUPS, RUN_DUTIES, dueFrom, type Kind, type TemplateStep } from './template';
import * as T from './tasks';
import * as L from './learn';
import { buildMail, runUrl, sendMail, welcomeUrl, type Line } from './mail';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const bad = (message: string, code = 'bad_request', status = 400) => new HttpError(status, code, message);

export interface Actor {
  email: string;
  name: string;
  admin: boolean;
}

export interface RunRow {
  id: string;
  kind: Kind;
  email: string;
  name: string;
  title: string;
  team: string;
  supervisor_email: string;
  date: string;
  status: string;
  hq: number;
  stays: number;
  welcome: string;
  hub_done: number;
  hub_done_at: string | null;
  hub_done_by: string | null;
  project_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface StepRow {
  id: string;
  run_id: string;
  key: string;
  grp: string;
  sort: number;
  title: string;
  detail: string;
  kind: string;
  duty: string;
  owner_email: string;
  due_date: string | null;
  status: string;
  done_by: string | null;
  done_at: string | null;
  link_url: string;
  link_label: string;
  task_id: string | null;
  note: string;
}

const RUN_COLS = 'id, kind, email, name, title, team, supervisor_email, date, status, hq, stays, welcome, hub_done, hub_done_at, hub_done_by, project_id, created_by, created_at, updated_at, completed_at';
const STEP_COLS = 'id, run_id, key, grp, sort, title, detail, kind, duty, owner_email, due_date, status, done_by, done_at, link_url, link_label, task_id, note';

/* ------------------------------------------------------------------------------------------------ access */

export async function mayManage(env: Env, actor: Actor): Promise<boolean> {
  return actor.admin || (await isHr(env, actor.email));
}

export async function onboardingReady(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT id FROM onb_runs LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

async function log(env: Env, runId: string, actor: string, event: string, detail: unknown = ''): Promise<void> {
  await env.DB.prepare('INSERT INTO onb_log (run_id, actor, event, detail, at) VALUES (?, ?, ?, ?, ?)')
    .bind(runId, lower(actor), event, typeof detail === 'string' ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600), nowIso())
    .run()
    .catch(() => null);
}

/* ------------------------------------------------------------------------------------------------ owners and the template */

export async function ownersMap(env: Env): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    for (const r of (await env.DB.prepare('SELECT duty, email FROM onb_owners').all<{ duty: string; email: string }>()).results || []) out[r.duty] = lower(r.email);
  } catch {
    /* not applied */
  }
  return out;
}

export async function setOwner(env: Env, actor: Actor, duty: string, email: string): Promise<void> {
  if (!DUTIES.some((d) => d.key === duty)) throw bad('Unknown duty.');
  const e = lower(email);
  if (e && !FAVOR.test(e)) throw bad('Pick a Favor address.');
  await env.DB.prepare('INSERT INTO onb_owners (duty, email, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(duty) DO UPDATE SET email = excluded.email, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(duty, e, lower(actor.email), nowIso())
    .run();
}

interface TplRow {
  key: string; grp: string; sort: number; title: string; detail: string; step_kind: string; duty: string; offset_days: number;
  link_url: string; link_label: string; hq_only: number; leaving_only: number; docs: string; active: number;
}

/** The template for a kind: HR's edited list when there is one, the built-in list otherwise. */
export async function templateFor(env: Env, kind: Kind, includeOff = false): Promise<Array<TemplateStep & { active: boolean; edited: boolean }>> {
  let rows: TplRow[] = [];
  try {
    rows = (await env.DB.prepare(
      'SELECT key, grp, sort, title, detail, step_kind, duty, offset_days, link_url, link_label, hq_only, leaving_only, docs, active FROM onb_template WHERE kind = ? ORDER BY sort, key'
    ).bind(kind).all<TplRow>()).results || [];
  } catch {
    rows = [];
  }
  if (!rows.length) return DEFAULTS[kind].map((s) => ({ ...s, active: true, edited: false }));
  return rows
    .filter((r) => includeOff || r.active)
    .map((r) => ({
      key: r.key, grp: r.grp, sort: r.sort, title: r.title, detail: r.detail, step_kind: r.step_kind as TemplateStep['step_kind'], duty: r.duty,
      offset_days: r.offset_days, link_url: r.link_url, link_label: r.link_label, hq_only: !!r.hq_only, leaving_only: !!r.leaving_only,
      docs: (() => { try { return JSON.parse(r.docs || '[]'); } catch { return []; } })(), active: !!r.active, edited: true,
    }));
}

async function seedTemplate(env: Env, kind: Kind): Promise<void> {
  const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM onb_template WHERE kind = ?').bind(kind).first<{ n: number }>();
  if (Number(have?.n) > 0) return;
  for (const s of DEFAULTS[kind]) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO onb_template (id, kind, key, grp, sort, title, detail, step_kind, duty, offset_days, link_url, link_label, hq_only, leaving_only, docs, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
      .bind(newId('tpl'), kind, s.key, s.grp, s.sort, s.title, s.detail, s.step_kind, s.duty, s.offset_days, s.link_url || '', s.link_label || '', s.hq_only ? 1 : 0, s.leaving_only ? 1 : 0, JSON.stringify(s.docs || []))
      .run();
  }
}

export interface TemplateEdit {
  key?: string;
  title?: string;
  detail?: string;
  duty?: string;
  offset_days?: number;
  grp?: string;
  active?: boolean;
  step_kind?: string;
  link_url?: string;
  link_label?: string;
  sort?: number;
}

/** Edits one template step, or adds one when the key is new. The first edit copies the built-in list into the table. */
export async function editTemplate(env: Env, actor: Actor, kind: Kind, input: TemplateEdit): Promise<void> {
  await seedTemplate(env, kind);
  const key = String(input.key || '').trim() || 'custom_' + newId('k').slice(2, 10);
  const have = await env.DB.prepare('SELECT key FROM onb_template WHERE kind = ? AND key = ?').bind(kind, key).first();
  const duties = new Set([...DUTIES.map((d) => d.key), ...RUN_DUTIES]);
  if (input.duty !== undefined && !duties.has(input.duty)) throw bad('Unknown duty.');
  if (input.grp !== undefined && !GROUPS[kind].some((g) => g.key === input.grp)) throw bad('Unknown group.');
  if (!have) {
    const title = String(input.title || '').trim();
    if (!title) throw bad('A step needs a title.');
    const max = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM onb_template WHERE kind = ?').bind(kind).first<{ m: number }>();
    await env.DB.prepare(
      `INSERT INTO onb_template (id, kind, key, grp, sort, title, detail, step_kind, duty, offset_days, link_url, link_label, active) VALUES (?, ?, ?, ?, ?, ?, ?, 'task', ?, ?, ?, ?, 1)`
    )
      .bind(newId('tpl'), kind, key, input.grp || GROUPS[kind][0].key, Number(max?.m || 0) + 10, title.slice(0, 160), String(input.detail || '').slice(0, 800), input.duty || 'supervisor', Math.trunc(Number(input.offset_days) || 0), String(input.link_url || '').slice(0, 300), String(input.link_label || '').slice(0, 60))
      .run();
    return;
  }
  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
  if (input.title !== undefined) { if (!String(input.title).trim()) throw bad('A step needs a title.'); put('title', String(input.title).trim().slice(0, 160)); }
  if (input.detail !== undefined) put('detail', String(input.detail).slice(0, 800));
  if (input.duty !== undefined) put('duty', input.duty);
  if (input.offset_days !== undefined) put('offset_days', Math.max(-120, Math.min(365, Math.trunc(Number(input.offset_days) || 0))));
  if (input.grp !== undefined) put('grp', input.grp);
  if (input.active !== undefined) put('active', input.active ? 1 : 0);
  if (input.link_url !== undefined) put('link_url', String(input.link_url).slice(0, 300));
  if (input.link_label !== undefined) put('link_label', String(input.link_label).slice(0, 60));
  if (input.sort !== undefined) put('sort', Number(input.sort) || 0);
  if (!sets.length) return;
  await env.DB.prepare(`UPDATE onb_template SET ${sets.join(', ')} WHERE kind = ? AND key = ?`).bind(...args, kind, key).run();
}

/** Back to the built-in list. Runs already started keep the steps they have. */
export async function resetTemplate(env: Env, kind: Kind): Promise<void> {
  await env.DB.prepare('DELETE FROM onb_template WHERE kind = ?').bind(kind).run();
}

/* ------------------------------------------------------------------------------------------------ starting a run */

export interface StartInput {
  kind?: unknown;
  email?: unknown;
  name?: unknown;
  title?: unknown;
  team?: unknown;
  supervisor_email?: unknown;
  date?: unknown;
  hq?: unknown;
  stays?: unknown;
  welcome?: unknown;
}

function ownerFor(duty: string, run: { email: string; supervisor_email: string }, starter: string, owners: Record<string, string>): { email: string; fallback: boolean } {
  if (duty === 'hire') return { email: lower(run.email), fallback: false };
  if (duty === 'supervisor') return run.supervisor_email ? { email: run.supervisor_email, fallback: false } : { email: starter, fallback: true };
  if (duty === 'starter') return { email: starter, fallback: false };
  const o = owners[duty];
  return o ? { email: o, fallback: false } : { email: starter, fallback: true };
}

export async function startRun(env: Env, actor: Actor, input: StartInput): Promise<{ run: RunRow; steps: StepRow[]; unset: string[]; mailed: number }> {
  if (!(await mayManage(env, actor))) throw new HttpError(403, 'forbidden', 'Starting onboarding is for hub admins and HR.');
  if (!(await onboardingReady(env))) throw new HttpError(503, 'not_ready', 'Onboarding is not switched on yet.');
  const kind: Kind = input.kind === 'offboard' ? 'offboard' : 'onboard';
  const email = lower(input.email);
  const name = String(input.name || '').trim().slice(0, 120);
  if (!FAVOR.test(email)) throw bad('Enter their Favor email address.');
  if (!name) throw bad('Enter their name.');
  const date = String(input.date || '');
  if (!DATE.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z'))) throw bad(kind === 'onboard' ? 'Pick the start date.' : 'Pick the last day.');
  const supervisor = lower(input.supervisor_email) || (await supervisorOf(env, email));
  if (supervisor && !FAVOR.test(supervisor)) throw bad('Pick the supervisor from the staff list.');
  const open = await env.DB.prepare(`SELECT id FROM onb_runs WHERE email = ? AND kind = ? AND status = 'active'`).bind(email, kind).first<{ id: string }>();
  if (open) throw new HttpError(409, 'exists', `${name} already has an ${kind === 'onboard' ? 'onboarding' : 'offboarding'} in progress.`);
  if (kind === 'offboard' && email === actor.email) throw bad('You cannot start your own offboarding.');
  const stays = kind === 'offboard' && (input.stays === true || input.stays === 1) ? 1 : 0;
  const hq = input.hq === false || input.hq === 0 ? 0 : 1;

  const now = nowIso();
  const id = newId('onb');
  const projectId = await T.ensureProject(env, actor.email);
  const run: RunRow = {
    id, kind, email, name, title: String(input.title || '').trim().slice(0, 120), team: String(input.team || '').trim().slice(0, 80), supervisor_email: supervisor,
    date, status: 'active', hq, stays, welcome: String(input.welcome || '').trim().slice(0, 1200), hub_done: 0, hub_done_at: null, hub_done_by: null,
    project_id: projectId, created_by: lower(actor.email), created_at: now, updated_at: now, completed_at: null,
  };
  await env.DB.prepare(
    `INSERT INTO onb_runs (id, kind, email, name, title, team, supervisor_email, date, status, hq, stays, welcome, hub_done, project_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?, ?)`
  )
    .bind(id, kind, email, name, run.title, run.team, supervisor, date, hq, stays, run.welcome, projectId, run.created_by, now, now)
    .run();

  const owners = await ownersMap(env);
  const tpl = (await templateFor(env, kind)).filter((s) => (hq || !s.hq_only) && (!stays || !s.leaving_only));
  const unset = new Set<string>();
  const gate = await T.noticeGate(env);
  const steps: StepRow[] = [];
  for (const s of tpl) {
    const o = ownerFor(s.duty, run, run.created_by, owners);
    if (o.fallback) unset.add(s.duty);
    const due = dueFrom(date, s.offset_days);
    const step: StepRow = {
      id: newId('stp'), run_id: id, key: s.key, grp: s.grp, sort: s.sort, title: s.title, detail: s.detail, kind: s.step_kind, duty: s.duty, owner_email: o.email,
      due_date: due, status: 'open', done_by: null, done_at: null, link_url: s.link_url || '', link_label: s.link_label || '', task_id: null, note: '',
    };
    if (projectId && o.email) {
      step.task_id = await T.makeTask(env, { projectId, title: kind === 'onboard' ? `${s.title} (${name})` : `${s.title} (${name}, leaving)`, description: s.detail, owner: o.email, due, by: actor.email, runId: id, stepKey: s.key }).catch((err) => { console.error('[onboarding] task', err); return null; }) as string | null;
      if (step.task_id) await T.noticeAssigned(env, step.task_id, o.email, actor.email, `${s.title} (${name})`, gate);
    }
    await env.DB.prepare(`INSERT INTO onb_steps (${STEP_COLS}) VALUES (${STEP_COLS.split(',').map(() => '?').join(', ')})`)
      .bind(step.id, id, step.key, step.grp, step.sort, step.title, step.detail, step.kind, step.duty, step.owner_email, step.due_date, step.status, null, null, step.link_url, step.link_label, step.task_id, '')
      .run();
    steps.push(step);
    for (const [i, label] of (s.docs || []).entries()) {
      await env.DB.prepare('INSERT OR IGNORE INTO onb_docs (run_id, key, label, sort, got) VALUES (?, ?, ?, ?, 0)').bind(id, `${s.key}_${i}`, label, i).run();
    }
  }
  await log(env, id, actor.email, 'started', { kind, date, steps: steps.length });
  const mailed = await mailStart(env, run, steps, actor);
  return { run, steps, unset: [...unset], mailed };
}

/** One email to each step owner with what they own in this run. The person who started it gets none. */
async function mailStart(env: Env, run: RunRow, steps: StepRow[], actor: Actor): Promise<number> {
  const by = new Map<string, StepRow[]>();
  for (const s of steps) if (s.owner_email && s.owner_email !== lower(actor.email) && s.owner_email !== run.email) by.set(s.owner_email, [...(by.get(s.owner_email) || []), s]);
  let sent = 0;
  const first = run.name.split(/\s+/)[0] || run.name;
  for (const [to, list] of by) {
    const lines: Line[] = list.slice(0, 12).map((s) => ({ title: s.title, due: s.due_date }));
    const mail = buildMail({
      pill: run.kind === 'onboard' ? 'Onboarding' : 'Offboarding',
      title: run.kind === 'onboard' ? `${first} starts ${new Date(run.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' })}` : `${first}’s last day is ${new Date(run.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' })}`,
      intro: `${actor.name} started ${run.kind === 'onboard' ? 'onboarding' : 'offboarding'} for ${run.name}. You own ${list.length === 1 ? 'this step' : `these ${list.length} steps`}.`,
      lines,
      button: { label: 'Open the steps', url: runUrl(run.id) },
      foot: 'Each step is also a task in Projects with its due date.',
    });
    if (await sendMail(env, to, mail)) sent++;
  }
  return sent;
}

/* ------------------------------------------------------------------------------------------------ reading */

export interface RunSummary extends RunRow {
  steps: number;
  done: number;
  late: number;
  next: { title: string; due: string | null; owner: string } | null;
}

export async function listRuns(env: Env, actor: Actor, status: 'active' | 'done' | 'all' = 'active'): Promise<RunSummary[]> {
  const manage = await mayManage(env, actor);
  const where = status === 'all' ? '' : status === 'done' ? `WHERE r.status <> 'active'` : `WHERE r.status = 'active'`;
  const rows = (await env.DB.prepare(`SELECT ${RUN_COLS.split(', ').map((c) => 'r.' + c).join(', ')} FROM onb_runs r ${where} ORDER BY r.status, r.date DESC LIMIT 200`).all<RunRow>().catch(() => ({ results: [] as RunRow[] }))).results || [];
  const steps = (await env.DB.prepare(`SELECT run_id, title, status, due_date, owner_email FROM onb_steps WHERE run_id IN (SELECT id FROM onb_runs ${where.replace(/r\./g, '')}) ORDER BY due_date, sort`).all<{ run_id: string; title: string; status: string; due_date: string | null; owner_email: string }>().catch(() => ({ results: [] }))).results || [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const by = new Map<string, typeof steps>();
  for (const s of steps) by.set(s.run_id, [...(by.get(s.run_id) || []), s]);
  const out: RunSummary[] = [];
  for (const r of rows) {
    const mine = by.get(r.id) || [];
    const involved = manage || lower(r.supervisor_email) === actor.email || mine.some((s) => lower(s.owner_email) === actor.email);
    if (!involved || (!manage && lower(r.email) === actor.email)) continue;
    const open = mine.filter((s) => s.status === 'open');
    out.push({
      ...r,
      steps: mine.filter((s) => s.status !== 'skipped').length,
      done: mine.filter((s) => s.status === 'done').length,
      late: open.filter((s) => s.due_date && s.due_date < today).length,
      next: open[0] ? { title: open[0].title, due: open[0].due_date, owner: lower(open[0].owner_email) } : null,
    });
  }
  return out;
}

async function getRun(env: Env, id: string): Promise<RunRow> {
  const row = await env.DB.prepare(`SELECT ${RUN_COLS} FROM onb_runs WHERE id = ?`).bind(id).first<RunRow>();
  if (!row) throw new HttpError(404, 'not_found', 'No such onboarding.');
  return row;
}

async function stepsOf(env: Env, runId: string): Promise<StepRow[]> {
  return (await env.DB.prepare(`SELECT ${STEP_COLS} FROM onb_steps WHERE run_id = ? ORDER BY sort, rowid`).bind(runId).all<StepRow>()).results || [];
}

/** Brings the steps in line with the tasks in Projects and the paths in Learn, then closes the run when nothing is left. */
async function reconcile(env: Env, run: RunRow, steps: StepRow[]): Promise<StepRow[]> {
  if (run.status !== 'active') return steps;
  const states = await T.taskStates(env, steps.map((s) => s.task_id || ''));
  const finished = run.kind === 'onboard' ? await L.pathsFinished(env, run.email) : {};
  const now = nowIso();
  for (const s of steps) {
    if (s.status !== 'open') continue;
    const t = s.task_id ? states.get(s.task_id) : undefined;
    let by = '';
    if (t && t.status === 'done') by = t.done_by || s.owner_email;
    else if (s.kind === 'learn' && finished[s.key]) by = run.email;
    if (by) {
      s.status = 'done';
      s.done_by = lower(by);
      s.done_at = now;
      await env.DB.prepare(`UPDATE onb_steps SET status = 'done', done_by = ?, done_at = ? WHERE id = ?`).bind(s.done_by, now, s.id).run();
      if (s.task_id && (!t || t.status !== 'done')) await T.setTaskDone(env, s.task_id, true, by);
    }
  }
  await maybeClose(env, run, steps);
  return steps;
}

async function maybeClose(env: Env, run: RunRow, steps: StepRow[]): Promise<void> {
  if (run.status !== 'active' || !steps.length) return;
  if (steps.some((s) => s.status === 'open')) return;
  const now = nowIso();
  await env.DB.prepare(`UPDATE onb_runs SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`).bind(now, now, run.id).run();
  run.status = 'done';
  run.completed_at = now;
  await log(env, run.id, 'system', 'completed');
}

export interface Detail {
  run: RunRow;
  steps: Array<StepRow & { owner_name: string; mine: boolean; overdue: boolean; fallback: boolean }>;
  groups: Array<{ key: string; label: string }>;
  docs: Array<{ key: string; label: string; got: boolean; got_at: string | null }>;
  docsStep: string | null;
  people: Record<string, { name: string; picture: string; title: string }>;
  can: { manage: boolean; hub: boolean };
  progress: { done: number; total: number };
  events: Array<{ actor: string; event: string; detail: string; at: string }>;
  tasks: boolean;
  learn: boolean;
}

export async function runDetail(env: Env, actor: Actor, id: string): Promise<Detail> {
  const run = await getRun(env, id);
  const manage = await mayManage(env, actor);
  let steps = await stepsOf(env, id);
  const involved = manage || run.supervisor_email === actor.email || steps.some((s) => lower(s.owner_email) === actor.email);
  if (!involved) throw new HttpError(403, 'forbidden', 'This onboarding is for HR, the supervisor and the people who own its steps.');
  steps = await reconcile(env, run, steps);
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const owners = await ownersMap(env);
  const who = (e: string) => (e ? dir.get(lower(e))?.name || (lower(e) === run.email ? run.name : lower(e).split('@')[0]) : '');
  const people: Detail['people'] = {};
  const need = new Set<string>([run.email, run.supervisor_email, run.created_by, ...steps.map((s) => s.owner_email)].filter(Boolean).map(lower));
  for (const e of need) {
    const p = dir.get(e);
    people[e] = { name: p?.name || (e === run.email ? run.name : e.split('@')[0]), picture: p?.picture || '', title: p?.title || '' };
  }
  const docs = (await env.DB.prepare('SELECT key, label, got, got_at FROM onb_docs WHERE run_id = ? ORDER BY sort').bind(id).all<{ key: string; label: string; got: number; got_at: string | null }>()).results || [];
  const events = (await env.DB.prepare('SELECT actor, event, detail, at FROM onb_log WHERE run_id = ? ORDER BY id DESC LIMIT 40').bind(id).all<{ actor: string; event: string; detail: string; at: string }>()).results || [];
  const out = steps.map((s) => ({
    ...s,
    owner_name: who(s.owner_email),
    mine: lower(s.owner_email) === actor.email,
    overdue: s.status === 'open' && !!s.due_date && s.due_date < today,
    fallback: ['directory', 'whatsapp', 'hr', 'training', 'tech', 'overseer'].includes(s.duty) && !owners[s.duty],
  }));
  return {
    run,
    steps: out,
    groups: GROUPS[run.kind],
    docs: docs.map((d) => ({ key: d.key, label: d.label, got: !!d.got, got_at: d.got_at })),
    docsStep: docs.length ? (steps.find((s) => s.key === 'file')?.id || null) : null,
    people,
    can: { manage, hub: manage },
    progress: { done: steps.filter((s) => s.status === 'done').length, total: steps.filter((s) => s.status !== 'skipped').length },
    events: events.map((e) => ({ ...e, actor: who(e.actor) || e.actor })),
    tasks: await T.tasksReady(env),
    learn: await L.learnReady(env),
  };
}

/* ------------------------------------------------------------------------------------------------ changing a run */

async function stepAccess(env: Env, actor: Actor, run: RunRow, step: StepRow, manage: boolean): Promise<void> {
  if (manage || lower(step.owner_email) === actor.email || (step.duty === 'supervisor' && run.supervisor_email === actor.email)) return;
  throw new HttpError(403, 'forbidden', 'Only the step’s owner, HR or a hub admin can change this step.');
}

export interface StepEdit {
  status?: unknown;
  owner_email?: unknown;
  due_date?: unknown;
  note?: unknown;
  title?: unknown;
  detail?: unknown;
}

export async function editStep(env: Env, actor: Actor, runId: string, stepId: string, input: StepEdit): Promise<void> {
  const run = await getRun(env, runId);
  const step = await env.DB.prepare(`SELECT ${STEP_COLS} FROM onb_steps WHERE id = ? AND run_id = ?`).bind(stepId, runId).first<StepRow>();
  if (!step) throw new HttpError(404, 'not_found', 'No such step.');
  const manage = await mayManage(env, actor);
  await stepAccess(env, actor, run, step, manage);
  if (run.status === 'cancelled') throw bad('This run was cancelled.');
  const now = nowIso();
  if (input.status !== undefined) {
    const st = String(input.status);
    if (!['open', 'done', 'skipped'].includes(st)) throw bad('Unknown status.');
    if (st === 'skipped' && !manage) throw new HttpError(403, 'forbidden', 'Only HR or a hub admin can skip a step.');
    if (step.kind === 'auto' && st === 'done' && !manage) throw new HttpError(403, 'forbidden', 'FavorOS does this step when an admin presses its button.');
    await env.DB.prepare('UPDATE onb_steps SET status = ?, done_by = ?, done_at = ? WHERE id = ?').bind(st, st === 'open' ? null : actor.email, st === 'open' ? null : now, stepId).run();
    if (step.task_id) {
      if (st === 'done') await T.setTaskDone(env, step.task_id, true, actor.email);
      else if (st === 'open') await T.setTaskDone(env, step.task_id, false, actor.email);
      else await T.dropTask(env, step.task_id);
    }
    await log(env, runId, actor.email, `step ${st}`, step.title);
    if (run.status === 'done' && st !== 'done') {
      await env.DB.prepare(`UPDATE onb_runs SET status = 'active', completed_at = NULL WHERE id = ?`).bind(runId).run();
    }
  }
  if (input.note !== undefined) await env.DB.prepare('UPDATE onb_steps SET note = ? WHERE id = ?').bind(String(input.note).slice(0, 500), stepId).run();
  const needManage = input.owner_email !== undefined || input.due_date !== undefined || input.title !== undefined || input.detail !== undefined;
  if (needManage && !manage) throw new HttpError(403, 'forbidden', 'Only HR or a hub admin can change who owns a step, its date or its words.');
  if (input.owner_email !== undefined) {
    const e = lower(input.owner_email);
    if (e && !FAVOR.test(e)) throw bad('Pick a Favor address.');
    await env.DB.prepare('UPDATE onb_steps SET owner_email = ? WHERE id = ?').bind(e, stepId).run();
    if (step.task_id) {
      await T.patchTask(env, step.task_id, { owner: e });
      await T.noticeAssigned(env, step.task_id, e, actor.email, `${step.title} (${run.name})`, await T.noticeGate(env));
    }
    await log(env, runId, actor.email, 'owner changed', `${step.title} to ${e || 'nobody'}`);
  }
  if (input.due_date !== undefined) {
    const d = input.due_date ? String(input.due_date) : null;
    if (d && !DATE.test(d)) throw bad('Dates look like 2026-10-19.');
    await env.DB.prepare('UPDATE onb_steps SET due_date = ? WHERE id = ?').bind(d, stepId).run();
    if (step.task_id) await T.patchTask(env, step.task_id, { due: d });
  }
  if (input.title !== undefined && String(input.title).trim()) await env.DB.prepare('UPDATE onb_steps SET title = ? WHERE id = ?').bind(String(input.title).trim().slice(0, 160), stepId).run();
  if (input.detail !== undefined) await env.DB.prepare('UPDATE onb_steps SET detail = ? WHERE id = ?').bind(String(input.detail).slice(0, 800), stepId).run();
  await env.DB.prepare('UPDATE onb_runs SET updated_at = ? WHERE id = ?').bind(now, runId).run();
  const fresh = await stepsOf(env, runId);
  await maybeClose(env, run, fresh);
}

export async function addStep(env: Env, actor: Actor, runId: string, input: { title?: unknown; detail?: unknown; owner_email?: unknown; due_date?: unknown; grp?: unknown }): Promise<StepRow> {
  if (!(await mayManage(env, actor))) throw new HttpError(403, 'forbidden', 'Adding a step is for hub admins and HR.');
  const run = await getRun(env, runId);
  if (run.status === 'cancelled') throw bad('This run was cancelled.');
  const title = String(input.title || '').trim();
  if (!title) throw bad('A step needs a title.');
  const owner = lower(input.owner_email) || lower(actor.email);
  if (!FAVOR.test(owner)) throw bad('Pick a Favor address for the owner.');
  const due = input.due_date ? String(input.due_date) : null;
  if (due && !DATE.test(due)) throw bad('Dates look like 2026-10-19.');
  const grp = GROUPS[run.kind].some((g) => g.key === input.grp) ? String(input.grp) : GROUPS[run.kind][0].key;
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM onb_steps WHERE run_id = ?').bind(runId).first<{ m: number }>();
  const step: StepRow = {
    id: newId('stp'), run_id: runId, key: 'custom_' + newId('k').slice(2, 8), grp, sort: Number(max?.m || 0) + 10, title: title.slice(0, 160), detail: String(input.detail || '').slice(0, 800),
    kind: 'task', duty: '', owner_email: owner, due_date: due, status: 'open', done_by: null, done_at: null, link_url: '', link_label: '', task_id: null, note: '',
  };
  const projectId = run.project_id || (await T.ensureProject(env, actor.email));
  if (projectId) {
    step.task_id = await T.makeTask(env, { projectId, title: `${step.title} (${run.name})`, description: step.detail, owner, due, by: actor.email, runId, stepKey: step.key }).catch(() => null) as string | null;
    if (step.task_id) await T.noticeAssigned(env, step.task_id, owner, actor.email, `${step.title} (${run.name})`, await T.noticeGate(env));
  }
  await env.DB.prepare(`INSERT INTO onb_steps (${STEP_COLS}) VALUES (${STEP_COLS.split(',').map(() => '?').join(', ')})`)
    .bind(step.id, runId, step.key, step.grp, step.sort, step.title, step.detail, step.kind, step.duty, step.owner_email, step.due_date, step.status, null, null, '', '', step.task_id, '')
    .run();
  if (run.status === 'done') await env.DB.prepare(`UPDATE onb_runs SET status = 'active', completed_at = NULL WHERE id = ?`).bind(runId).run();
  await log(env, runId, actor.email, 'step added', title);
  return step;
}

export async function setDoc(env: Env, actor: Actor, runId: string, key: string, got: boolean): Promise<void> {
  const run = await getRun(env, runId);
  const steps = await stepsOf(env, runId);
  const file = steps.find((s) => s.key === 'file');
  const manage = await mayManage(env, actor);
  if (!manage && !(file && lower(file.owner_email) === actor.email)) throw new HttpError(403, 'forbidden', 'The HR file is kept by HR.');
  const r = await env.DB.prepare('UPDATE onb_docs SET got = ?, got_by = ?, got_at = ? WHERE run_id = ? AND key = ?').bind(got ? 1 : 0, got ? actor.email : null, got ? nowIso() : null, runId, key).run();
  if (!Number((r.meta as { changes?: number }).changes)) throw new HttpError(404, 'not_found', 'No such document.');
  await log(env, runId, actor.email, got ? 'document received' : 'document unchecked', key);
  void run;
}

export async function editRun(env: Env, actor: Actor, runId: string, input: { welcome?: unknown; supervisor_email?: unknown; status?: unknown; title?: unknown; team?: unknown }): Promise<void> {
  if (!(await mayManage(env, actor))) throw new HttpError(403, 'forbidden', 'Changing a run is for hub admins and HR.');
  const run = await getRun(env, runId);
  const sets: string[] = [];
  const args: unknown[] = [];
  if (input.welcome !== undefined) { sets.push('welcome = ?'); args.push(String(input.welcome).slice(0, 1200)); }
  if (input.title !== undefined) { sets.push('title = ?'); args.push(String(input.title).slice(0, 120)); }
  if (input.team !== undefined) { sets.push('team = ?'); args.push(String(input.team).slice(0, 80)); }
  if (input.supervisor_email !== undefined) {
    const e = lower(input.supervisor_email);
    if (e && !FAVOR.test(e)) throw bad('Pick the supervisor from the staff list.');
    sets.push('supervisor_email = ?'); args.push(e);
  }
  if (input.status !== undefined) {
    if (input.status !== 'cancelled') throw bad('A run can be cancelled here; it closes itself when every step is done.');
    sets.push(`status = 'cancelled'`);
    const steps = await stepsOf(env, runId);
    for (const s of steps) if (s.task_id && s.status === 'open') await T.dropTask(env, s.task_id);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(nowIso(), runId);
  await env.DB.prepare(`UPDATE onb_runs SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
  await log(env, runId, actor.email, input.status ? 'cancelled' : 'run edited');
  void run;
}

/* ------------------------------------------------------------------------------------------------ FavorOS adds and closes */

export interface DoneItem {
  what: string;
  state: 'done' | 'skipped' | 'failed';
  note?: string;
}

async function tableThere(env: Env, table: string): Promise<boolean> {
  try {
    await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

async function markAuto(env: Env, run: RunRow, key: string, actor: Actor): Promise<void> {
  const now = nowIso();
  const step = await env.DB.prepare(`SELECT ${STEP_COLS} FROM onb_steps WHERE run_id = ? AND key = ?`).bind(run.id, key).first<StepRow>();
  if (step && step.status === 'open') {
    await env.DB.prepare(`UPDATE onb_steps SET status = 'done', done_by = ?, done_at = ? WHERE id = ?`).bind(actor.email, now, step.id).run();
    if (step.task_id) await T.setTaskDone(env, step.task_id, true, actor.email);
  }
  if (key === 'hubadd' || key === 'hubclose') await env.DB.prepare('UPDATE onb_runs SET hub_done = 1, hub_done_at = ?, hub_done_by = ?, updated_at = ? WHERE id = ?').bind(now, actor.email, now, run.id).run();
  const fresh = await stepsOf(env, run.id);
  await maybeClose(env, run, fresh);
}

/** Adds the new hire to FavorOS: the account, the staff list, the supervisor and start date, the default Chat channels and the Learn paths. */
export async function hubAdd(env: Env, actor: Actor, runId: string, opts: { emailWelcome?: boolean } = {}): Promise<{ items: DoneItem[]; mailed: boolean }> {
  if (!(await mayManage(env, actor))) throw new HttpError(403, 'forbidden', 'Adding someone to FavorOS is for hub admins and HR.');
  const run = await getRun(env, runId);
  if (run.kind !== 'onboard') throw bad('This is an offboarding.');
  if (run.status !== 'active') throw bad('This onboarding is closed.');
  if (!FAVOR.test(run.email)) throw bad('The run has no Favor address.');
  const now = nowIso();
  const items: DoneItem[] = [];
  const step = async (what: string, fn: () => Promise<DoneItem | void>) => {
    try {
      const r = await fn();
      items.push(r || { what, state: 'done' });
    } catch (err) {
      console.error('[onboarding] hubAdd', what, err);
      items.push({ what, state: 'failed', note: 'Did not save. Try again.' });
    }
  };
  await step('FavorOS account', async () => {
    await env.DB.prepare(
      `INSERT INTO hub_users (email, name, picture, role, blocked, note, created_at, updated_at) VALUES (?, ?, '', 'staff', 0, '', ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = CASE WHEN hub_users.name = '' THEN excluded.name ELSE hub_users.name END, blocked = 0, note = '', updated_at = excluded.updated_at`
    ).bind(run.email, run.name, now, now).run();
  });
  await step('Staff list for pickers', async () => {
    await env.DB.prepare(
      `INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT(email) DO UPDATE SET name = excluded.name, title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE meet_directory.title END, team = CASE WHEN excluded.team <> '' THEN excluded.team ELSE meet_directory.team END, active = 1`
    ).bind(run.email, run.name, run.title, run.team).run();
  });
  await step('Supervisor and start date', async () => {
    if (!(await tableThere(env, 'hub_reporting'))) return { what: 'Supervisor and start date', state: 'skipped', note: 'People reporting lines are not switched on yet.' };
    const prev = await reportingOf(env, run.email);
    await env.DB.prepare(
      `INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET supervisor_email = excluded.supervisor_email, department = excluded.department, title = excluded.title, start_date = excluded.start_date, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).bind(run.email, run.supervisor_email || prev.supervisor || null, run.team || prev.department || null, run.title || prev.title || null, run.date, actor.email, now).run();
  });
  await step('Default Chat channels', async () => {
    if (!(await tableThere(env, 'chat_members'))) return { what: 'Default Chat channels', state: 'skipped', note: 'Chat is not switched on yet.' };
    await joinDefaults(env as never, run.email);
  });
  const given = await L.assignPaths(env, run.email, actor.email, {
    ospath: dueOf(run, 7),
    favpath: dueOf(run, 14),
  });
  for (const g of given) {
    items.push({
      what: g.title,
      state: g.state === 'given' || g.state === 'already' ? 'done' : 'skipped',
      note: g.state === 'already' ? 'Already assigned.' : g.state === 'missing' ? 'This path is not written in Learn yet.' : g.state === 'off' ? 'Learn is not switched on yet.' : undefined,
    });
  }
  let mailed = false;
  if (opts.emailWelcome !== false) {
    const first = run.name.split(/\s+/)[0] || run.name;
    const mail = buildMail({
      pill: 'Welcome',
      title: `Welcome to Favor, ${first}`,
      intro: 'Your first-day page has who to meet, your first week and the FavorOS tour. Sign in with your Favor Google account.',
      lines: [],
      button: { label: 'Open your first-day page', url: welcomeUrl },
      foot: 'FavorOS is where Favor staff do their daily work.',
    });
    mailed = await sendMail(env, run.email, mail);
    items.push({ what: 'First-day email', state: mailed ? 'done' : 'skipped', note: mailed ? undefined : 'Email to staff is off, so nothing was sent. The first-day page works when they sign in.' });
  }
  await markAuto(env, run, 'hubadd', actor);
  await log(env, runId, actor.email, 'added to FavorOS', items.map((i) => `${i.what}: ${i.state}`).join('; '));
  return { items, mailed };
}

const dueOf = (run: RunRow, offset: number) => dueFrom(run.date, offset);

/** Closes the person's FavorOS access: blocked, sessions and the Google link ended, off the staff lists, Learn assignments closed. */
export async function hubClose(env: Env, actor: Actor, runId: string, isEnvAdmin: (email: string) => boolean): Promise<{ items: DoneItem[] }> {
  if (!(await mayManage(env, actor))) throw new HttpError(403, 'forbidden', 'Closing access is for hub admins and HR.');
  const run = await getRun(env, runId);
  if (run.kind !== 'offboard') throw bad('This is an onboarding.');
  if (run.status !== 'active') throw bad('This offboarding is closed.');
  if (run.stays) throw bad('This person stays on as a volunteer, so their accounts stay open.');
  if (run.email === actor.email) throw bad('You cannot close your own access.');
  if (isEnvAdmin(run.email)) throw bad('This person is listed as a hub admin in the site settings. Remove them from that list first.');
  const now = nowIso();
  const items: DoneItem[] = [];
  const step = async (what: string, fn: () => Promise<DoneItem | void>) => {
    try {
      items.push((await fn()) || { what, state: 'done' });
    } catch (err) {
      console.error('[onboarding] hubClose', what, err);
      items.push({ what, state: 'failed', note: 'Did not save. Try again.' });
    }
  };
  await step('Block the FavorOS account', async () => {
    await env.DB.prepare(
      `INSERT INTO hub_users (email, name, picture, role, blocked, note, created_at, updated_at) VALUES (?, ?, '', 'staff', 1, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET blocked = 1, role = 'staff', note = excluded.note, updated_at = excluded.updated_at`
    ).bind(run.email, run.name, `Left Favor ${run.date}`, now, now).run();
  });
  await step('End open sessions', async () => { await env.DB.prepare('DELETE FROM hub_sessions WHERE email = ?').bind(run.email).run(); });
  await step('Unlink Google', async () => {
    if (!(await tableThere(env, 'hub_google'))) return { what: 'Unlink Google', state: 'skipped', note: 'No Google link on file.' };
    await env.DB.prepare('DELETE FROM hub_google WHERE email = ?').bind(run.email).run();
  });
  await step('Off the staff lists', async () => {
    await env.DB.prepare('UPDATE meet_directory SET active = 0 WHERE lower(email) = ?').bind(run.email).run();
    if (await tableThere(env, 'act_staff')) await env.DB.prepare('UPDATE act_staff SET active = 0 WHERE lower(email) = ?').bind(run.email).run();
  });
  await step('Close Learn assignments', async () => {
    const n = await L.closeAssignments(env, run.email);
    return { what: 'Close Learn assignments', state: n ? 'done' : 'skipped', note: n ? `${n} closed.` : 'None open.' };
  });
  await markAuto(env, run, 'hubclose', actor);
  await log(env, runId, actor.email, 'FavorOS access closed', items.map((i) => `${i.what}: ${i.state}`).join('; '));
  return { items };
}

/* ------------------------------------------------------------------------------------------------ what a leaving person still owns */

export interface Owned {
  tasks: Array<{ id: string; code: string | null; title: string; due: string | null }>;
  requests: Array<{ id: string; title: string; due: string | null }>;
  reports: Array<{ email: string; name: string }>;
  learn: number;
  counts: { tasks: number; requests: number; reports: number };
}

export async function ownedBy(env: Env, actor: Actor, runId: string): Promise<Owned> {
  if (!(await mayManage(env, actor))) throw new HttpError(403, 'forbidden', 'This list is for hub admins and HR.');
  const run = await getRun(env, runId);
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const out: Owned = { tasks: [], requests: [], reports: [], learn: await L.openAssignments(env, run.email), counts: { tasks: 0, requests: 0, reports: 0 } };
  try {
    const r = await env.DB.prepare(
      `SELECT t.id, t.code, t.title, t.due_date AS due FROM hub_tasks t WHERE lower(t.owner_email) = ? AND t.status NOT IN ('done', 'dropped') AND COALESCE(t.project_id, '') <> COALESCE((SELECT id FROM hub_projects WHERE key = 'ONB'), '-') ORDER BY t.due_date LIMIT 100`
    ).bind(run.email).all<{ id: string; code: string | null; title: string; due: string | null }>();
    out.tasks = r.results || [];
  } catch { /* Projects is not applied */ }
  try {
    const r = await env.DB.prepare(
      `SELECT t.request_id AS id, q.title, t.due_date AS due FROM request_tasks t JOIN requests q ON q.id = t.request_id WHERE lower(t.owner_email) = ? AND q.status NOT IN ('done', 'declined') ORDER BY t.due_date LIMIT 100`
    ).bind(run.email).all<{ id: string; title: string; due: string | null }>();
    out.requests = r.results || [];
  } catch { /* the request board tasks are not applied */ }
  out.reports = (await allReporting(env)).filter((x) => x.supervisor === run.email).map((x) => ({ email: x.email, name: dir.get(x.email)?.name || x.email.split('@')[0] }));
  out.counts = { tasks: out.tasks.length, requests: out.requests.length, reports: out.reports.length };
  return out;
}

/** Moves the person's open tasks, request cards and direct reports to someone else. Nothing is deleted. */
export async function handOver(env: Env, actor: Actor, runId: string, toRaw: unknown, what: { tasks?: boolean; requests?: boolean; reports?: boolean } = {}): Promise<{ tasks: number; requests: number; reports: number }> {
  if (!(await mayManage(env, actor))) throw new HttpError(403, 'forbidden', 'Handing over work is for hub admins and HR.');
  const run = await getRun(env, runId);
  if (run.kind !== 'offboard') throw bad('This is an onboarding.');
  const to = lower(toRaw);
  if (!FAVOR.test(to) || to === run.email) throw bad('Pick the person who takes over.');
  const dir = await staffDirectory(env);
  if (!dir.some((p: Person) => p.email === to)) throw bad('Pick someone from the staff list.');
  const out = { tasks: 0, requests: 0, reports: 0 };
  const now = nowIso();
  if (what.tasks !== false) {
    try {
      const r = await env.DB.prepare(`UPDATE hub_tasks SET owner_email = ?, updated_at = ? WHERE lower(owner_email) = ? AND status NOT IN ('done', 'dropped') AND COALESCE(project_id, '') <> COALESCE((SELECT id FROM hub_projects WHERE key = 'ONB'), '-')`).bind(to, now, run.email).run();
      out.tasks = Number((r.meta as { changes?: number }).changes) || 0;
    } catch { /* Projects is not applied */ }
  }
  if (what.requests !== false) {
    try {
      const r = await env.DB.prepare(`UPDATE request_tasks SET owner_email = ?, sent_by = ?, sent_at = ?, updated_at = ? WHERE lower(owner_email) = ? AND request_id IN (SELECT id FROM requests WHERE status NOT IN ('done', 'declined'))`).bind(to, lower(actor.email), now, now, run.email).run();
      out.requests = Number((r.meta as { changes?: number }).changes) || 0;
    } catch { /* not applied */ }
  }
  if (what.reports !== false && (await tableThere(env, 'hub_reporting'))) {
    const r = await env.DB.prepare('UPDATE hub_reporting SET supervisor_email = ?, updated_by = ?, updated_at = ? WHERE lower(supervisor_email) = ?').bind(to, lower(actor.email), now, run.email).run();
    out.reports = Number((r.meta as { changes?: number }).changes) || 0;
  }
  await log(env, runId, actor.email, 'work handed over', { to, ...out });
  const step = await env.DB.prepare(`SELECT ${STEP_COLS} FROM onb_steps WHERE run_id = ? AND key = 'handover'`).bind(runId).first<StepRow>();
  if (step && step.status === 'open') await markAuto(env, run, 'handover', actor);
  return out;
}
