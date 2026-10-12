// Evaluation cycle: terms, cases, the three forms, reviewers, the supervisor's summary and plan, the meeting, acknowledgment, HR signature.
// Every read and write takes the signed-in actor and applies the access rule here, not in the page:
//   the employee reads their own self-assessment and, once shared, the supervisor's summary and plan. Never a reviewer's words.
//   a reviewer reads and writes only their own Form B.
//   the supervisor, HR (hub_hr) and hub admins read every answer with the reviewer's name. Not about themselves.
// Nothing here feeds search, Favor Brain, dashboards or Chat.
import { HttpError, newId, nowIso, type Env } from '../http';
import { staffDirectory, type Person } from '../people';
import { allReporting, isHr, reportingOf, supervisorOf } from '../people-dev';
import { FORM_A, FORM_B, FORM_C, PLAN_AREAS, SCALE, type Form } from '../../../src/data/evaluation-forms';
import {
  addDays, cleanAnswer, competencyAverages, gapsOf, GOALS_MAX, GOALS_MIN, isComplete, isDate, mayManage, mayReadRaw, mayReadSelf, periodFor, progressOf,
  REVIEWERS_MAX, REVIEWERS_MIN, stageAtLeast, STAGE_WORD, themesOf, todayEt, weekDue, formOf, type Ans, type FormId, type Gaps, type Viewer,
} from './rules';
import { tell, tellOnce } from './mail';
import { evidenceFor, type Evidence } from './evidence';

export interface Actor {
  email: string;
  name: string;
  role: 'admin' | 'staff';
}

type Db = Env;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);

export async function viewerOf(env: Db, a: Actor): Promise<Viewer> {
  return { email: lower(a.email), admin: a.role === 'admin', hr: await isHr(env, a.email) };
}

export const mayRunEvals = (v: Viewer) => v.admin || v.hr;

/* ---------------------------------------------------------------------------------------------------------- rows */

export interface CaseRow {
  id: string;
  term_id: string;
  employee_email: string;
  supervisor_email: string | null;
  stage: string;
  w1_due: string | null;
  w2_due: string | null;
  w3_due: string | null;
  self_submitted_at: string | null;
  reviewers_chosen_at: string | null;
  summary_submitted_at: string | null;
  meeting_on: string | null;
  acknowledged_at: string | null;
  acknowledged_note: string | null;
  signed_by: string | null;
  signed_at: string | null;
  doc_url: string | null;
  doc_error: string | null;
  created_at: string;
  updated_at: string;
  term_name: string;
  period_label: string;
  starts_on: string;
  term_status: string;
}

export interface ReviewerRow {
  id: string;
  case_id: string;
  reviewer_email: string;
  relationship: string;
  frequency: string;
  status: string;
  asked_at: string;
  submitted_at: string | null;
}

const CASE_SQL = `SELECT c.*, t.name AS term_name, t.period_label, t.starts_on, t.status AS term_status FROM eval_cases c JOIN eval_terms t ON t.id = c.term_id`;

export async function caseOf(env: Db, id: string): Promise<CaseRow> {
  const r = await env.DB.prepare(`${CASE_SQL} WHERE c.id = ?`).bind(id).first<CaseRow>();
  if (!r) throw new HttpError(404, 'no_case', 'That evaluation is not here.');
  return r;
}

export async function reviewersOf(env: Db, caseId: string, all = false): Promise<ReviewerRow[]> {
  const r = await env.DB.prepare(`SELECT * FROM eval_reviewers WHERE case_id = ?${all ? '' : " AND status IN ('asked','submitted')"} ORDER BY asked_at, reviewer_email`).bind(caseId).all<ReviewerRow>();
  return r.results || [];
}

export async function answersOf(env: Db, caseId: string, form: FormId, author: string): Promise<Ans[]> {
  const r = await env.DB.prepare('SELECT qid, rating, text, example FROM eval_answers WHERE case_id = ? AND form = ? AND author_email = ?').bind(caseId, form, author).all<Ans>();
  return r.results || [];
}

export async function names(env: Db): Promise<Map<string, Person>> {
  return new Map((await staffDirectory(env)).map((p) => [p.email, p]));
}

export const who = (dir: Map<string, Person>, email: string | null | undefined) => {
  const e = lower(email);
  const p = dir.get(e);
  return { email: e, name: p?.name || (e ? e.split('@')[0] : ''), title: p?.title || '', team: p?.team || '', picture: p?.picture || '' };
};

/* ------------------------------------------------------------------------------------------------- terms (admin) */

export interface TermInput {
  name?: string;
  startsOn?: string;
  periodLabel?: string;
  emails?: string[];
}

export async function startTerm(env: Db, actor: Actor, b: TermInput): Promise<{ termId: string; opened: number; skipped: Array<{ email: string; why: string }>; noSupervisor: string[] }> {
  const v = await viewerOf(env, actor);
  if (!mayRunEvals(v)) throw new HttpError(403, 'forbidden', 'Opening an evaluation term is for HR and hub administrators.');
  const startsOn = String(b.startsOn || '');
  if (!isDate(startsOn)) throw new HttpError(400, 'bad_date', 'Pick the date week 1 begins.');
  const emails = [...new Set((b.emails || []).map(lower).filter(Boolean))];
  if (!emails.length) throw new HttpError(400, 'no_people', 'Pick at least one person.');
  const period = clip(b.periodLabel, 80) || periodFor(startsOn);
  const name = clip(b.name, 80) || `${period} evaluations`;
  const dir = await names(env);
  const now = nowIso();
  const termId = newId('evt');
  await env.DB.prepare('INSERT INTO eval_terms (id, name, period_label, starts_on, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(termId, name, period, startsOn, 'open', lower(actor.email), now).run();
  const due = weekDue(startsOn);
  const skipped: Array<{ email: string; why: string }> = [];
  const noSupervisor: string[] = [];
  let opened = 0;
  for (const email of emails) {
    if (!dir.has(email)) {
      skipped.push({ email, why: 'Not on the staff list.' });
      continue;
    }
    const open = await env.DB.prepare(`SELECT c.id FROM eval_cases c JOIN eval_terms t ON t.id = c.term_id WHERE c.employee_email = ? AND t.status = 'open' AND t.period_label = ?`).bind(email, period).first();
    if (open) {
      skipped.push({ email, why: 'Already has an evaluation for this period.' });
      continue;
    }
    const sup = await supervisorOf(env, email);
    if (!sup) noSupervisor.push(email);
    const id = newId('evc');
    await env.DB.prepare(
      'INSERT INTO eval_cases (id, term_id, employee_email, supervisor_email, stage, w1_due, w2_due, w3_due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, termId, email, sup || null, 'self', due.w1, due.w2, due.w3, now, now).run();
    opened++;
    await tell(env, email, 'Your evaluation is open', {
      heading: 'Your self-assessment is open',
      lines: [`Complete Form A and name 3 to 5 people who work with you by ${longDate(due.w1)}. Your answers save as you go.`],
      button: 'Open my evaluation',
      path: `/evaluations/?c=${id}`,
    });
  }
  return { termId, opened, skipped, noSupervisor };
}

export const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

export async function closeTerm(env: Db, actor: Actor, termId: string): Promise<void> {
  if (!mayRunEvals(await viewerOf(env, actor))) throw new HttpError(403, 'forbidden', 'That is for HR and hub administrators.');
  await env.DB.prepare("UPDATE eval_terms SET status = 'closed' WHERE id = ?").bind(termId).run();
}

export interface Behind {
  who: string;
  what: string;
  due: string;
}

export interface CaseLine {
  id: string;
  employee: ReturnType<typeof who>;
  supervisor: ReturnType<typeof who>;
  stage: string;
  stageWord: string;
  self: boolean;
  reviewers: number;
  reviewersDone: number;
  summary: boolean;
  acknowledged: boolean;
  signed: boolean;
  meetingOn: string;
  due: { w1: string; w2: string; w3: string };
  behind: Behind[];
  docUrl: string;
}

/** Cases of one term with who is behind. Raw answers never appear here. */
export async function termReport(env: Db, actor: Actor, termId: string, now: Date = new Date()): Promise<{ term: { id: string; name: string; periodLabel: string; startsOn: string; status: string }; cases: CaseLine[]; folder: string }> {
  if (!mayRunEvals(await viewerOf(env, actor))) throw new HttpError(403, 'forbidden', 'That is for HR and hub administrators.');
  const t = await env.DB.prepare('SELECT * FROM eval_terms WHERE id = ?').bind(termId).first<{ id: string; name: string; period_label: string; starts_on: string; status: string }>();
  if (!t) throw new HttpError(404, 'no_term', 'That term is not here.');
  const rows = (await env.DB.prepare(`${CASE_SQL} WHERE c.term_id = ? ORDER BY c.employee_email`).bind(termId).all<CaseRow>()).results || [];
  const dir = await names(env);
  const today = todayEt(now);
  const cases: CaseLine[] = [];
  for (const c of rows) cases.push(await lineOf(env, c, dir, today));
  const { evalFolder } = await import('./drive');
  return { term: { id: t.id, name: t.name, periodLabel: t.period_label, startsOn: t.starts_on, status: t.status }, cases, folder: await evalFolder(env) };
}

async function lineOf(env: Db, c: CaseRow, dir: Map<string, Person>, today: string): Promise<CaseLine> {
  const revs = await reviewersOf(env, c.id);
  const done = revs.filter((r) => r.status === 'submitted').length;
  const due = { w1: c.w1_due || '', w2: c.w2_due || '', w3: c.w3_due || '' };
  const behind: Behind[] = [];
  const emp = who(dir, c.employee_email);
  const sup = who(dir, c.supervisor_email);
  if (!c.supervisor_email) behind.push({ who: emp.name, what: 'No supervisor assigned', due: '' });
  if (!c.self_submitted_at && due.w1 && today > due.w1) behind.push({ who: emp.name, what: 'Self-assessment', due: due.w1 });
  if (revs.length < REVIEWERS_MIN && due.w1 && today > due.w1) behind.push({ who: emp.name, what: `Reviewers named (${revs.length} of ${REVIEWERS_MIN} to ${REVIEWERS_MAX})`, due: due.w1 });
  for (const r of revs) if (r.status === 'asked' && due.w2 && today > due.w2) behind.push({ who: who(dir, r.reviewer_email).name, what: `Feedback on ${emp.name}`, due: due.w2 });
  if (!c.summary_submitted_at && c.self_submitted_at && due.w3 && today > due.w3) behind.push({ who: sup.name || 'No supervisor', what: 'Supervisor summary and plan', due: due.w3 });
  if (c.stage === 'meeting' && c.meeting_on && today > addDays(c.meeting_on, 3)) behind.push({ who: emp.name, what: 'Acknowledgment', due: c.meeting_on });
  return {
    id: c.id,
    employee: emp,
    supervisor: sup,
    stage: c.stage,
    stageWord: STAGE_WORD[c.stage] || c.stage,
    self: !!c.self_submitted_at,
    reviewers: revs.length,
    reviewersDone: done,
    summary: !!c.summary_submitted_at,
    acknowledged: !!c.acknowledged_at,
    signed: !!c.signed_at,
    meetingOn: c.meeting_on || '',
    due,
    behind,
    docUrl: c.doc_url || '',
  };
}

export async function listTerms(env: Db, actor: Actor): Promise<Array<{ id: string; name: string; periodLabel: string; startsOn: string; status: string; people: number; done: number }>> {
  if (!mayRunEvals(await viewerOf(env, actor))) throw new HttpError(403, 'forbidden', 'That is for HR and hub administrators.');
  const r = await env.DB.prepare(
    `SELECT t.id, t.name, t.period_label, t.starts_on, t.status, COUNT(c.id) AS people, SUM(CASE WHEN c.stage IN ('signed','done') THEN 1 ELSE 0 END) AS done
       FROM eval_terms t LEFT JOIN eval_cases c ON c.term_id = t.id GROUP BY t.id ORDER BY t.starts_on DESC, t.created_at DESC`
  ).all<{ id: string; name: string; period_label: string; starts_on: string; status: string; people: number; done: number | null }>();
  return (r.results || []).map((t) => ({ id: t.id, name: t.name, periodLabel: t.period_label, startsOn: t.starts_on, status: t.status, people: Number(t.people) || 0, done: Number(t.done) || 0 }));
}

/** Staff for the term picker, grouped by start date. A blank start date sorts into "unknown" so the admin picks. */
export async function pickList(env: Db, actor: Actor): Promise<Array<{ email: string; name: string; title: string; team: string; startDate: string; supervisor: string; hasSupervisor: boolean; open: boolean }>> {
  if (!mayRunEvals(await viewerOf(env, actor))) throw new HttpError(403, 'forbidden', 'That is for HR and hub administrators.');
  const [dir, rep, open] = await Promise.all([
    staffDirectory(env),
    allReporting(env),
    env.DB.prepare("SELECT c.employee_email AS e FROM eval_cases c JOIN eval_terms t ON t.id = c.term_id WHERE t.status = 'open' AND c.stage NOT IN ('done')").all<{ e: string }>(),
  ]);
  const by = new Map(rep.map((r) => [r.email, r]));
  const openSet = new Set((open.results || []).map((r) => lower(r.e)));
  const names2 = new Map(dir.map((p) => [p.email, p.name]));
  return dir.map((p) => {
    const r = by.get(p.email);
    return { email: p.email, name: p.name, title: r?.title || p.title, team: r?.department || p.team, startDate: r?.startDate || '', supervisor: r?.supervisor ? names2.get(r.supervisor) || r.supervisor : '', hasSupervisor: !!r?.supervisor, open: openSet.has(p.email) };
  });
}

export async function changeSupervisor(env: Db, actor: Actor, caseId: string, email: string): Promise<void> {
  const v = await viewerOf(env, actor);
  const c = await caseOf(env, caseId);
  if (!mayManage(v, { employee: c.employee_email, supervisor: lower(c.supervisor_email) })) throw new HttpError(403, 'forbidden', 'That is for HR and hub administrators.');
  const sup = lower(email);
  if (sup === c.employee_email) throw new HttpError(400, 'self_supervisor', 'Nobody supervises their own evaluation.');
  if (sup && !(await names(env)).has(sup)) throw new HttpError(400, 'no_person', 'Pick someone from the staff list.');
  await env.DB.prepare('UPDATE eval_cases SET supervisor_email = ?, updated_at = ? WHERE id = ?').bind(sup || null, nowIso(), caseId).run();
}

/* -------------------------------------------------------------------------------------------------- my evaluations */

export interface Mine {
  me: { email: string; name: string };
  manage: boolean;
  hr: boolean;
  own: Array<{ id: string; term: string; period: string; stage: string; stageWord: string; next: string; due: string; self: { done: number; total: number }; reviewers: number; mine: boolean }>;
  owe: Array<{ caseId: string; employee: string; relationship: string; due: string; status: string; progress: { done: number; total: number } }>;
  team: Array<{ id: string; employee: string; period: string; stage: string; stageWord: string; next: string; due: string; self: boolean; reviewersDone: number; reviewers: number }>;
  needsSign: Array<{ id: string; employee: string; period: string }>;
  reports: Array<{ email: string; name: string }>;
}

/** What the next step is for the person looking, in one short line. */
function nextFor(c: CaseRow, role: 'employee' | 'supervisor', revs: number, revsDone: number): { next: string; due: string } {
  if (role === 'employee') {
    if (!c.self_submitted_at) return { next: 'Finish and submit your self-assessment', due: c.w1_due || '' };
    if (revs < REVIEWERS_MIN) return { next: `Name ${REVIEWERS_MIN} to ${REVIEWERS_MAX} people to give feedback`, due: c.w1_due || '' };
    if (!c.summary_submitted_at) return { next: 'Waiting for feedback and your supervisor\'s summary', due: c.w3_due || '' };
    if (c.stage === 'meeting') return { next: c.meeting_on ? `Meeting on ${shortDate(c.meeting_on)}, then acknowledge` : 'Read the summary and your plan, then acknowledge', due: c.meeting_on || '' };
    if (c.stage === 'acknowledged') return { next: 'Acknowledged. Waiting for HR to sign', due: '' };
    return { next: 'Complete', due: '' };
  }
  if (!c.supervisor_email) return { next: 'No supervisor assigned', due: '' };
  if (!c.self_submitted_at) return { next: 'Waiting for the self-assessment', due: c.w1_due || '' };
  if (!c.summary_submitted_at) return { next: revsDone < REVIEWERS_MIN ? `Write the summary (${revsDone} of ${revs} feedback forms in)` : 'Write the summary and the six-month plan', due: c.w3_due || '' };
  if (c.stage === 'meeting') return { next: 'Shared. Waiting for the employee to acknowledge', due: c.meeting_on || '' };
  if (c.stage === 'acknowledged') return { next: 'Acknowledged. Waiting for HR to sign', due: '' };
  return { next: 'Complete', due: '' };
}

const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

export async function mine(env: Db, actor: Actor): Promise<Mine> {
  const me = lower(actor.email);
  const v = await viewerOf(env, actor);
  const dir = await names(env);
  const own: Mine['own'] = [];
  for (const c of (await env.DB.prepare(`${CASE_SQL} WHERE c.employee_email = ? ORDER BY t.starts_on DESC`).bind(me).all<CaseRow>()).results || []) {
    const revs = await reviewersOf(env, c.id);
    const a = await answersOf(env, c.id, 'A', me);
    const p = progressOf(FORM_A, a);
    const n = nextFor(c, 'employee', revs.length, revs.filter((r) => r.status === 'submitted').length);
    own.push({ id: c.id, term: c.term_name, period: c.period_label, stage: c.stage, stageWord: STAGE_WORD[c.stage] || c.stage, next: n.next, due: n.due, self: { done: p.done, total: p.total }, reviewers: revs.length, mine: true });
  }
  const owe: Mine['owe'] = [];
  const rr = await env.DB.prepare(
    `SELECT r.*, c.employee_email, c.w2_due, t.period_label FROM eval_reviewers r JOIN eval_cases c ON c.id = r.case_id JOIN eval_terms t ON t.id = c.term_id
      WHERE r.reviewer_email = ? AND r.status IN ('asked','submitted') AND c.stage NOT IN ('signed','done') ORDER BY r.asked_at DESC`
  ).bind(me).all<ReviewerRow & { employee_email: string; w2_due: string | null }>();
  for (const r of rr.results || []) {
    const a = await answersOf(env, r.case_id, 'B', me);
    const p = progressOf(FORM_B, a);
    owe.push({ caseId: r.case_id, employee: who(dir, r.employee_email).name, relationship: r.relationship, due: r.w2_due || '', status: r.status, progress: { done: p.done, total: p.total } });
  }
  const team: Mine['team'] = [];
  for (const c of (await env.DB.prepare(`${CASE_SQL} WHERE c.supervisor_email = ? AND c.employee_email != ? ORDER BY t.starts_on DESC, c.employee_email`).bind(me, me).all<CaseRow>()).results || []) {
    const revs = await reviewersOf(env, c.id);
    const done = revs.filter((r) => r.status === 'submitted').length;
    const n = nextFor(c, 'supervisor', revs.length, done);
    team.push({ id: c.id, employee: who(dir, c.employee_email).name, period: c.period_label, stage: c.stage, stageWord: STAGE_WORD[c.stage] || c.stage, next: n.next, due: n.due, self: !!c.self_submitted_at, reviewersDone: done, reviewers: revs.length });
  }
  const needsSign: Mine['needsSign'] = [];
  if (v.hr || v.admin) {
    for (const c of (await env.DB.prepare(`${CASE_SQL} WHERE c.stage = 'acknowledged' AND c.employee_email != ?`).bind(me).all<CaseRow>()).results || []) needsSign.push({ id: c.id, employee: who(dir, c.employee_email).name, period: c.period_label });
  }
  const direct = (await env.DB.prepare('SELECT email FROM hub_reporting WHERE supervisor_email = ?').bind(me).all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }))).results || [];
  const reports = direct.map((r) => ({ email: lower(r.email), name: who(dir, r.email).name }));
  return { me: { email: me, name: actor.name }, manage: mayRunEvals(v), hr: v.hr, own, owe, team, needsSign, reports };
}

/** How many things are waiting on this person, for the menu badge and Today. */
export async function waitingOn(env: Db, actor: Actor): Promise<{ n: number; items: Array<{ text: string; href: string; due: string }> }> {
  let m: Mine;
  try {
    m = await mine(env, actor);
  } catch {
    return { n: 0, items: [] };
  }
  const items: Array<{ text: string; href: string; due: string }> = [];
  for (const o of m.own) {
    if (o.stage === 'self' || o.stage === 'feedback' || o.stage === 'summary') {
      if (o.next.startsWith('Finish') || o.next.startsWith('Name')) items.push({ text: o.next, href: `/evaluations/?c=${o.id}`, due: o.due });
    } else if (o.stage === 'meeting') items.push({ text: 'Read your summary and acknowledge', href: `/evaluations/?c=${o.id}`, due: o.due });
  }
  for (const r of m.owe) if (r.status === 'asked') items.push({ text: `Feedback for ${r.employee}`, href: `/evaluations/?c=${r.caseId}`, due: r.due });
  for (const t of m.team) if (t.self && (t.stage === 'feedback' || t.stage === 'summary')) items.push({ text: `Summary for ${t.employee}`, href: `/evaluations/?c=${t.id}`, due: t.due });
  for (const s of m.needsSign) items.push({ text: `Sign ${s.employee}'s evaluation`, href: `/evaluations/?c=${s.id}`, due: '' });
  return { n: items.length, items };
}

/* ------------------------------------------------------------------------------------------------------ one case */

export interface CaseView {
  case: {
    id: string; term: string; period: string; stage: string; stageWord: string; due: { w1: string; w2: string; w3: string }; meetingOn: string;
    acknowledgedAt: string; acknowledgedNote: string; signedBy: string; signedAt: string; docUrl: string; docError: string;
    selfSubmitted: boolean; summaryShared: boolean; termOpen: boolean;
    employee: ReturnType<typeof who>; supervisor: ReturnType<typeof who>;
  };
  role: { employee: boolean; supervisor: boolean; reviewer: boolean; manage: boolean; raw: boolean; hr: boolean };
  next: string;
  self?: { answers: Ans[]; submitted: boolean; progress: { done: number; total: number; optional: number }; gaps: Gaps };
  reviewers?: Array<{ email: string; name: string; relationship: string; frequency: string; status: string; submittedAt: string; mine?: boolean }>;
  mineB?: { answers: Ans[]; submitted: boolean; progress: { done: number; total: number; optional: number }; gaps: Gaps; relationship: string; frequency: string };
  feedback?: Array<{ reviewer: string; email: string; relationship: string; frequency: string; submitted: boolean; answers: Ans[] }>;
  analysis?: { rows: ReturnType<typeof competencyAverages>['rows']; categories: ReturnType<typeof competencyAverages>['categories']; themes: ReturnType<typeof themesOf>; reviewersIn: number };
  summary?: { answers: Ans[]; goals: GoalRow[]; submitted: boolean; gaps: Gaps; progress: { done: number; total: number; optional: number }; editable: boolean };
  priorGoals?: Array<GoalRow & { period: string }>;
  learning?: Array<{ title: string; completedAt: string }>;
  /** What the records show for the year before week 1. Employee and reviewers of the case (supervisor, HR, admins) only. */
  evidence?: Evidence;
  /** True when nobody is set under Reports to for the employee. Shown to HR and admins as a prompt; the app never picks a manager. */
  reportsToMissing?: boolean;
  scale: typeof SCALE;
}

export interface GoalRow {
  id: string;
  area: string;
  goal: string;
  steps: string;
  support: string;
  target_date: string | null;
  course_id: string | null;
  task_id: string | null;
  review_status: string;
  review_note: string;
}

export async function goalsOf(env: Db, caseId: string): Promise<GoalRow[]> {
  return ((await env.DB.prepare('SELECT id, area, goal, steps, support, target_date, course_id, task_id, review_status, review_note FROM eval_goals WHERE case_id = ? ORDER BY created_at, id').bind(caseId).all<GoalRow>()).results || []);
}

export async function viewCase(env: Db, actor: Actor, caseId: string): Promise<CaseView> {
  const c = await caseOf(env, caseId);
  const me = lower(actor.email);
  const v = await viewerOf(env, actor);
  const facts = { employee: c.employee_email, supervisor: lower(c.supervisor_email) };
  const revsAll = await reviewersOf(env, c.id);
  const myRev = revsAll.find((r) => r.reviewer_email === me);
  const isEmp = me === c.employee_email;
  const raw = mayReadRaw(v, facts);
  if (!isEmp && !raw && !myRev) throw new HttpError(403, 'forbidden', 'You are not part of that evaluation.');
  const dir = await names(env);
  const revCount = revsAll.length;
  const done = revsAll.filter((r) => r.status === 'submitted').length;
  const roleName: 'employee' | 'supervisor' = isEmp ? 'employee' : 'supervisor';
  const view: CaseView = {
    case: {
      id: c.id, term: c.term_name, period: c.period_label, stage: c.stage, stageWord: STAGE_WORD[c.stage] || c.stage, due: { w1: c.w1_due || '', w2: c.w2_due || '', w3: c.w3_due || '' },
      meetingOn: c.meeting_on || '', acknowledgedAt: c.acknowledged_at || '', acknowledgedNote: c.acknowledged_note || '', signedBy: c.signed_by ? who(dir, c.signed_by).name : '', signedAt: c.signed_at || '',
      docUrl: c.doc_url || '', docError: c.doc_error || '', selfSubmitted: !!c.self_submitted_at, summaryShared: !!c.summary_submitted_at, termOpen: c.term_status === 'open',
      employee: who(dir, c.employee_email), supervisor: who(dir, c.supervisor_email),
    },
    role: { employee: isEmp, supervisor: me === facts.supervisor, reviewer: !!myRev && myRev.status !== 'removed', manage: mayManage(v, facts), raw, hr: v.hr },
    next: isEmp || raw ? nextFor(c, roleName, revCount, done).next : myRev?.status === 'submitted' ? 'Submitted. Thank you.' : 'Write your feedback',
    scale: SCALE,
  };
  // A reviewer who is also the supervisor or HR sees everything those roles see, and their own Form B too.
  if (mayReadSelf(v, facts)) {
    const a = await answersOf(env, c.id, 'A', c.employee_email);
    view.self = { answers: a, submitted: !!c.self_submitted_at, progress: progressOf(FORM_A, a), gaps: gapsOf(FORM_A, a) };
  }
  if (isEmp || raw) {
    const shown = (await reviewersOf(env, c.id, true)).filter((r) => r.status !== 'removed');
    view.reviewers = shown.map((r) => ({ email: r.reviewer_email, name: who(dir, r.reviewer_email).name, relationship: r.relationship, frequency: r.frequency, status: r.status, submittedAt: r.submitted_at || '' }));
  }
  if (myRev && myRev.status !== 'removed') {
    const a = await answersOf(env, c.id, 'B', me);
    view.mineB = { answers: a, submitted: myRev.status === 'submitted', progress: progressOf(FORM_B, a), gaps: gapsOf(FORM_B, a), relationship: myRev.relationship, frequency: myRev.frequency };
  }
  if (raw) {
    const fb: NonNullable<CaseView['feedback']> = [];
    const all: Ans[][] = [];
    for (const r of revsAll) {
      const a = await answersOf(env, c.id, 'B', r.reviewer_email);
      fb.push({ reviewer: who(dir, r.reviewer_email).name, email: r.reviewer_email, relationship: r.relationship, frequency: r.frequency, submitted: r.status === 'submitted', answers: a });
      if (r.status === 'submitted') all.push(a);
    }
    view.feedback = fb;
    if (view.self) {
      const avg = competencyAverages(view.self.answers, all);
      const texts = all.map((a) => a.filter((x) => x.text && !['b3', 'b4'].includes(x.qid)).map((x) => x.text));
      view.analysis = { rows: avg.rows, categories: avg.categories, themes: themesOf(avg.rows, texts), reviewersIn: all.length };
    }
    view.learning = await (await import('./learning')).completedLearning(env, c.employee_email);
  }
  if (isEmp || raw) {
    const start = (await reportingOf(env, c.employee_email)).startDate;
    view.evidence = await evidenceFor(env, c.employee_email, c.starts_on, start);
  }
  if (!c.supervisor_email && (v.admin || v.hr)) view.reportsToMissing = true;
  const goals = await goalsOf(env, c.id);
  const shared = !!c.summary_submitted_at;
  if (raw || (isEmp && shared)) {
    const a = await answersOf(env, c.id, 'C', c.supervisor_email ? lower(c.supervisor_email) : '');
    const aa = a.length ? a : raw ? await anyAnswers(env, c.id, 'C') : [];
    view.summary = {
      answers: aa, goals, submitted: shared, gaps: gapsOf(FORM_C, aa), progress: progressOf(FORM_C, aa),
      editable: raw && !shared && c.term_status === 'open',
    };
  }
  if (raw || isEmp) {
    const prior = await env.DB.prepare(
      `SELECT g.id, g.area, g.goal, g.steps, g.support, g.target_date, g.course_id, g.task_id, g.review_status, g.review_note, t.period_label AS period
         FROM eval_goals g JOIN eval_cases c ON c.id = g.case_id JOIN eval_terms t ON t.id = c.term_id
        WHERE g.employee_email = ? AND g.case_id != ? AND t.starts_on < ? ORDER BY t.starts_on DESC, g.created_at`
    ).bind(c.employee_email, c.id, c.starts_on).all<GoalRow & { period: string }>();
    const list = prior.results || [];
    if (list.length) {
      const first = list[0].period;
      view.priorGoals = list.filter((g) => g.period === first);
    }
  }
  return view;
}

async function anyAnswers(env: Db, caseId: string, form: FormId): Promise<Ans[]> {
  const r = await env.DB.prepare('SELECT qid, rating, text, example FROM eval_answers WHERE case_id = ? AND form = ?').bind(caseId, form).all<Ans>();
  return r.results || [];
}

/* ------------------------------------------------------------------------------------------------------- saving */

async function writableFor(env: Db, actor: Actor, c: CaseRow, form: FormId): Promise<{ author: string }> {
  const me = lower(actor.email);
  const v = await viewerOf(env, actor);
  if (c.term_status !== 'open') throw new HttpError(409, 'closed', 'This term is closed.');
  if (form === 'A') {
    if (me !== c.employee_email) throw new HttpError(403, 'forbidden', 'Only the employee writes the self-assessment.');
    if (c.self_submitted_at) throw new HttpError(409, 'submitted', 'The self-assessment is submitted. Ask your supervisor to reopen it to change it.');
    return { author: me };
  }
  if (form === 'B') {
    const r = (await reviewersOf(env, c.id)).find((x) => x.reviewer_email === me);
    if (!r) throw new HttpError(403, 'forbidden', 'You were not asked for feedback on this evaluation.');
    if (r.status === 'submitted') throw new HttpError(409, 'submitted', 'You already submitted this feedback.');
    return { author: me };
  }
  const facts = { employee: c.employee_email, supervisor: lower(c.supervisor_email) };
  if (!mayReadRaw(v, facts) || (me !== facts.supervisor && !mayManage(v, facts))) throw new HttpError(403, 'forbidden', 'Only the supervisor writes the summary.');
  if (c.summary_submitted_at) throw new HttpError(409, 'shared', 'The summary is already shared. Ask HR to reopen it to change it.');
  if (!c.supervisor_email) throw new HttpError(409, 'no_supervisor', 'This evaluation has no supervisor yet.');
  // The summary is the supervisor's. When HR or an admin writes it, it is still saved under the supervisor.
  return { author: lower(c.supervisor_email) };
}

export async function saveAnswers(env: Db, actor: Actor, caseId: string, formId: string, list: unknown[], opts: { relationship?: string; frequency?: string } = {}): Promise<{ saved: number; progress: { done: number; total: number; optional: number } }> {
  if (!['A', 'B', 'C'].includes(formId)) throw new HttpError(400, 'bad_form', 'No such form.');
  const form = formOf(formId);
  const c = await caseOf(env, caseId);
  const { author } = await writableFor(env, actor, c, formId as FormId);
  if (formId === 'C' && c.stage === 'feedback') await env.DB.prepare("UPDATE eval_cases SET stage = 'summary', updated_at = ? WHERE id = ?").bind(nowIso(), c.id).run();
  const now = nowIso();
  let saved = 0;
  for (const raw of (Array.isArray(list) ? list : []).slice(0, 200)) {
    const a = cleanAnswer(form, raw as Record<string, unknown>);
    if (!a) continue;
    await env.DB.prepare(
      `INSERT INTO eval_answers (case_id, form, author_email, qid, rating, text, example, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id, form, author_email, qid) DO UPDATE SET rating = excluded.rating, text = excluded.text, example = excluded.example, updated_at = excluded.updated_at`
    ).bind(c.id, formId, author, a.qid, a.rating, a.text, a.example, now).run();
    saved++;
  }
  if (formId === 'B') {
    // The two choices on Form B say how the reviewer knows the employee. They also label the reviewer on the supervisor's page.
    const rel = await env.DB.prepare("SELECT text FROM eval_answers WHERE case_id = ? AND form = 'B' AND author_email = ? AND qid = 'b3'").bind(c.id, author).first<{ text: string }>();
    const fr = await env.DB.prepare("SELECT text FROM eval_answers WHERE case_id = ? AND form = 'B' AND author_email = ? AND qid = 'b4'").bind(c.id, author).first<{ text: string }>();
    await env.DB.prepare("UPDATE eval_reviewers SET relationship = COALESCE(NULLIF(?, ''), relationship), frequency = COALESCE(NULLIF(?, ''), frequency) WHERE case_id = ? AND reviewer_email = ?").bind(rel?.text || '', fr?.text || '', c.id, author).run();
  }
  if (formId === 'B' && (opts.relationship || opts.frequency)) {
    await env.DB.prepare('UPDATE eval_reviewers SET relationship = COALESCE(?, relationship), frequency = COALESCE(?, frequency) WHERE case_id = ? AND reviewer_email = ?').bind(opts.relationship || null, opts.frequency || null, c.id, author).run();
  }
  return { saved, progress: progressOf(form, await answersOf(env, c.id, formId as FormId, author)) };
}

export async function submitForm(env: Db, actor: Actor, caseId: string, formId: string, opts: { proceedWithFewer?: boolean; meetingOn?: string } = {}): Promise<{ ok: true; stage: string }> {
  const c = await caseOf(env, caseId);
  if (!['A', 'B', 'C'].includes(formId)) throw new HttpError(400, 'bad_form', 'No such form.');
  const { author } = await writableFor(env, actor, c, formId as FormId);
  const form = formOf(formId);
  const dir = await names(env);
  const now = nowIso();
  if (formId === 'B') {
    const a = await answersOf(env, c.id, 'B', author);
    const g = gapsOf(form, a);
    if (!isComplete(g)) throw new HttpError(400, 'incomplete', gapMessage(g, form));
    await env.DB.prepare("UPDATE eval_reviewers SET status = 'submitted', submitted_at = ? WHERE case_id = ? AND reviewer_email = ?").bind(now, c.id, author).run();
    const sup = lower(c.supervisor_email);
    if (sup) {
      const revs = await reviewersOf(env, c.id);
      if (revs.every((r) => r.status === 'submitted') && c.self_submitted_at) {
        await tellOnce(env, `sup-ready:${c.id}`, sup, `${who(dir, c.employee_email).name}'s evaluation is ready for your summary`, {
          heading: 'Feedback is in', lines: [`The self-assessment and every feedback form for ${who(dir, c.employee_email).name} are in. Write the summary and the six-month plan by ${longDate(c.w3_due || c.w2_due || '')}.`], button: 'Open the evaluation', path: `/evaluations/?c=${c.id}`,
        });
      }
    }
    return { ok: true, stage: c.stage };
  }
  if (formId === 'A') {
    const a = await answersOf(env, c.id, 'A', author);
    const g = gapsOf(form, a);
    if (!isComplete(g)) throw new HttpError(400, 'incomplete', gapMessage(g, form));
    await env.DB.prepare('UPDATE eval_cases SET self_submitted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, c.id).run();
    return { ok: true, stage: await advance(env, c.id) };
  }
  // Form C
  if (!c.self_submitted_at) throw new HttpError(409, 'no_self', 'The self-assessment is not in yet.');
  const a = await answersOf(env, c.id, 'C', author);
  const g = gapsOf(form, a);
  if (!isComplete(g)) throw new HttpError(400, 'incomplete', gapMessage(g, form));
  const goals = await goalsOf(env, c.id);
  if (goals.length < GOALS_MIN || goals.length > GOALS_MAX) throw new HttpError(400, 'goals', `Write ${GOALS_MIN} to ${GOALS_MAX} priority goals in the development plan.`);
  for (const gl of goals) if (!gl.goal.trim() || !gl.steps.trim() || !gl.target_date) throw new HttpError(400, 'goals', 'Each goal needs the goal, the action steps and a target date.');
  const revs = await reviewersOf(env, c.id);
  const in_ = revs.filter((r) => r.status === 'submitted').length;
  if (in_ < REVIEWERS_MIN && !opts.proceedWithFewer) throw new HttpError(409, 'few_reviewers', `Only ${in_} of ${REVIEWERS_MIN} feedback forms are in. Confirm to go ahead with ${in_}.`);
  const meeting = opts.meetingOn || c.meeting_on || '';
  if (!isDate(meeting)) throw new HttpError(400, 'meeting', 'Pick the meeting date.');
  await env.DB.prepare("UPDATE eval_cases SET summary_submitted_at = ?, meeting_on = ?, stage = 'meeting', updated_at = ? WHERE id = ?").bind(now, meeting, now, c.id).run();
  await makeGoalTasks(env, c.id);
  await tell(env, c.employee_email, 'Your supervisor shared your evaluation summary', {
    heading: 'Your evaluation summary is ready',
    lines: [`Read the summary and your six-month development plan before the meeting on ${longDate(meeting)}. After the meeting you acknowledge it in FavorOS.`],
    button: 'Read it',
    path: `/evaluations/?c=${c.id}`,
  });
  return { ok: true, stage: 'meeting' };
}

function gapMessage(g: Gaps, form: Form): string {
  const parts: string[] = [];
  if (g.ratings.length) parts.push(`${g.ratings.length} rating${g.ratings.length === 1 ? '' : 's'} left`);
  if (g.examples.length) parts.push(`${g.examples.length} rating${g.examples.length === 1 ? '' : 's'} of 1 or 2 need an example`);
  if (g.texts.length) parts.push(`${g.texts.length} required answer${g.texts.length === 1 ? '' : 's'} left`);
  return `Form ${form.id} is not finished: ${parts.join(', ')}.`;
}

/** Moves a case from self to feedback once the self-assessment is in and 3 to 5 reviewers are named. */
export async function advance(env: Db, caseId: string): Promise<string> {
  const c = await caseOf(env, caseId);
  if (c.stage === 'self' && c.self_submitted_at) {
    const n = (await reviewersOf(env, c.id)).length;
    if (n >= REVIEWERS_MIN) {
      await env.DB.prepare("UPDATE eval_cases SET stage = 'feedback', reviewers_chosen_at = COALESCE(reviewers_chosen_at, ?), updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), c.id).run();
      const sup = lower(c.supervisor_email);
      if (sup) {
        const dir = await names(env);
        await tellOnce(env, `sup-open:${c.id}`, sup, `${who(dir, c.employee_email).name} finished the self-assessment`, {
          heading: 'A self-assessment is in',
          lines: [`${who(dir, c.employee_email).name} submitted Form A and named ${n} people for feedback. Feedback is due ${longDate(c.w2_due || '')}.`], button: 'Open the evaluation', path: `/evaluations/?c=${c.id}`,
        });
      }
      return 'feedback';
    }
  }
  return c.stage;
}

/* --------------------------------------------------------------------------------------------------- reviewers */

export async function setReviewers(env: Db, actor: Actor, caseId: string, list: Array<{ email?: string; relationship?: string }>, opts: { fewer?: boolean } = {}): Promise<{ reviewers: number; stage: string }> {
  const c = await caseOf(env, caseId);
  const me = lower(actor.email);
  const v = await viewerOf(env, actor);
  const facts = { employee: c.employee_email, supervisor: lower(c.supervisor_email) };
  const isEmp = me === c.employee_email;
  const priv = mayReadRaw(v, facts);
  if (!isEmp && !priv) throw new HttpError(403, 'forbidden', 'Only the employee, the supervisor, HR or an administrator can change the reviewers.');
  if (c.term_status !== 'open' || stageAtLeast(c.stage, 'meeting')) throw new HttpError(409, 'closed', 'The feedback round is over.');
  const dir = await names(env);
  const wanted = new Map<string, string>();
  for (const x of list || []) {
    const e = lower(x.email);
    if (!e) continue;
    if (e === c.employee_email) throw new HttpError(400, 'self_review', 'Pick people other than the employee.');
    if (!dir.has(e)) throw new HttpError(400, 'no_person', 'Pick reviewers from the staff list.');
    wanted.set(e, clip(x.relationship, 60));
  }
  if (wanted.size > REVIEWERS_MAX) throw new HttpError(400, 'too_many', `Name no more than ${REVIEWERS_MAX} reviewers.`);
  const min = isEmp ? REVIEWERS_MIN : opts.fewer ? 1 : REVIEWERS_MIN;
  if (wanted.size < min) throw new HttpError(400, 'too_few', `Name ${REVIEWERS_MIN} to ${REVIEWERS_MAX} reviewers.`);
  const now = nowIso();
  const have = await reviewersOf(env, c.id, true);
  const hold = new Map(have.map((r) => [r.reviewer_email, r]));
  const rep = await reportingOf(env, c.employee_email);
  const mgrs = new Set((await allReporting(env)).filter((r) => r.supervisor === c.employee_email).map((r) => r.email));
  for (const r of have) {
    if (wanted.has(r.reviewer_email) || r.status === 'removed' || r.status === 'declined') continue;
    // The employee cannot take back someone who already submitted. The supervisor and HR can set them aside.
    if (r.status === 'submitted' && isEmp && !priv) throw new HttpError(409, 'submitted', 'One of those reviewers already submitted. Only your supervisor can set that feedback aside.');
    await env.DB.prepare("UPDATE eval_reviewers SET status = 'removed' WHERE id = ?").bind(r.id).run();
  }
  for (const [email, relation] of wanted) {
    const prev = hold.get(email);
    const guess = relation || (email === rep.supervisor ? 'Immediate Supervisor' : mgrs.has(email) ? 'Direct Report' : '');
    if (prev && (prev.status === 'asked' || prev.status === 'submitted')) continue;
    if (prev) {
      await env.DB.prepare("UPDATE eval_reviewers SET status = 'asked', asked_at = ?, submitted_at = NULL, relationship = COALESCE(NULLIF(?, ''), relationship) WHERE id = ?").bind(now, guess, prev.id).run();
    } else {
      await env.DB.prepare('INSERT INTO eval_reviewers (id, case_id, reviewer_email, relationship, frequency, status, asked_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(newId('evr'), c.id, email, guess, '', 'asked', now).run();
    }
    await tell(env, email, `Feedback requested for ${who(dir, c.employee_email).name}`, {
      heading: `${who(dir, c.employee_email).name} asked for your feedback`,
      lines: [`Form B takes about 15 minutes and saves as you go. It is due ${longDate(c.w2_due || '')}. Your supervisor and HR read what you write with your name on it. The employee reads only a summary.`],
      button: 'Give feedback',
      path: `/evaluations/?c=${c.id}`,
    });
  }
  await env.DB.prepare('UPDATE eval_cases SET updated_at = ? WHERE id = ?').bind(now, c.id).run();
  const stage = await advance(env, c.id);
  return { reviewers: wanted.size, stage };
}

/** A reviewer says they cannot give feedback. The supervisor sees it and can ask someone else. */
export async function declineReview(env: Db, actor: Actor, caseId: string): Promise<void> {
  const c = await caseOf(env, caseId);
  const me = lower(actor.email);
  const r = (await reviewersOf(env, c.id)).find((x) => x.reviewer_email === me);
  if (!r || r.status !== 'asked') throw new HttpError(409, 'not_asked', 'There is nothing to decline.');
  await env.DB.prepare("UPDATE eval_reviewers SET status = 'declined' WHERE id = ?").bind(r.id).run();
}

/** Supervisor, HR or an admin reopens a submitted form so its author can change it. */
export async function reopenForm(env: Db, actor: Actor, caseId: string, formId: string, reviewerEmail?: string): Promise<void> {
  const c = await caseOf(env, caseId);
  const v = await viewerOf(env, actor);
  const facts = { employee: c.employee_email, supervisor: lower(c.supervisor_email) };
  if (!mayReadRaw(v, facts)) throw new HttpError(403, 'forbidden', 'Only the supervisor, HR or an administrator can reopen a form.');
  if (formId === 'A') {
    await env.DB.prepare("UPDATE eval_cases SET self_submitted_at = NULL, stage = CASE WHEN stage IN ('feedback','summary') THEN 'self' ELSE stage END, updated_at = ? WHERE id = ?").bind(nowIso(), c.id).run();
  } else if (formId === 'B') {
    await env.DB.prepare("UPDATE eval_reviewers SET status = 'asked', submitted_at = NULL WHERE case_id = ? AND reviewer_email = ?").bind(c.id, lower(reviewerEmail)).run();
  } else if (formId === 'C') {
    if (c.acknowledged_at) throw new HttpError(409, 'acknowledged', 'The employee already acknowledged it.');
    await env.DB.prepare("UPDATE eval_cases SET summary_submitted_at = NULL, stage = 'summary', updated_at = ? WHERE id = ?").bind(nowIso(), c.id).run();
  } else throw new HttpError(400, 'bad_form', 'No such form.');
}

/* ------------------------------------------------------------------------------------------------------ the plan */

export interface GoalInput {
  id?: string;
  area?: string;
  goal?: string;
  steps?: string;
  support?: string;
  targetDate?: string;
  courseId?: string;
}

export async function saveGoals(env: Db, actor: Actor, caseId: string, list: GoalInput[]): Promise<GoalRow[]> {
  const c = await caseOf(env, caseId);
  await writableFor(env, actor, c, 'C');
  if ((list || []).length > GOALS_MAX) throw new HttpError(400, 'too_many', `Keep the plan to ${GOALS_MAX} priority goals or fewer.`);
  const now = nowIso();
  const keep = new Set<string>();
  for (const g of list || []) {
    const area = PLAN_AREAS.includes(String(g.area)) ? String(g.area) : PLAN_AREAS[0];
    const target = isDate(g.targetDate) ? g.targetDate : null;
    const id = g.id && (await env.DB.prepare('SELECT id FROM eval_goals WHERE id = ? AND case_id = ?').bind(g.id, c.id).first()) ? g.id : newId('evg');
    keep.add(id);
    await env.DB.prepare(
      `INSERT INTO eval_goals (id, case_id, employee_email, area, goal, steps, support, target_date, course_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET area = excluded.area, goal = excluded.goal, steps = excluded.steps, support = excluded.support, target_date = excluded.target_date, course_id = excluded.course_id`
    ).bind(id, c.id, c.employee_email, area, clip(g.goal, 1000), clip(g.steps, 2000), clip(g.support, 1000), target, clip(g.courseId, 80) || null, now).run();
  }
  for (const g of await goalsOf(env, c.id)) if (!keep.has(g.id)) await env.DB.prepare('DELETE FROM eval_goals WHERE id = ?').bind(g.id).run();
  return goalsOf(env, c.id);
}

/** Last cycle's goals get a verdict at this cycle's review. */
export async function reviewGoal(env: Db, actor: Actor, goalId: string, status: string, note: string): Promise<void> {
  if (!['met', 'partly', 'not_met', ''].includes(status)) throw new HttpError(400, 'bad_status', 'Pick met, partly met or not met.');
  const g = await env.DB.prepare('SELECT employee_email, case_id FROM eval_goals WHERE id = ?').bind(goalId).first<{ employee_email: string; case_id: string }>();
  if (!g) throw new HttpError(404, 'no_goal', 'That goal is not here.');
  const v = await viewerOf(env, actor);
  const sup = await supervisorOf(env, g.employee_email);
  if (!mayReadRaw(v, { employee: g.employee_email, supervisor: sup })) throw new HttpError(403, 'forbidden', 'Only the supervisor, HR or an administrator can record how a goal went.');
  await env.DB.prepare('UPDATE eval_goals SET review_status = ?, review_note = ? WHERE id = ?').bind(status, clip(note, 1000), goalId).run();
}

/** Each goal becomes a task for the employee in Projects, linked back to the evaluation. Skipped quietly while Projects is not installed. */
export async function makeGoalTasks(env: Db, caseId: string): Promise<number> {
  let made = 0;
  const goals = await goalsOf(env, caseId);
  const c = await caseOf(env, caseId);
  for (const g of goals) {
    if (g.task_id) continue;
    const id = newId('tsk');
    const now = nowIso();
    try {
      await env.DB.prepare(
        `INSERT INTO hub_tasks (id, project_id, title, description, status, priority, owner_email, due_date, created_by, created_at, updated_at) VALUES (?, NULL, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?)`
      ).bind(id, clip(g.goal, 140), `Development goal from the ${c.period_label} evaluation.\n\nAction steps: ${g.steps}\n\nOpen the evaluation: https://dash.favorintl.org/evaluations/?c=${caseId}`, c.employee_email, g.target_date, lower(c.supervisor_email) || c.employee_email, now, now).run();
    } catch {
      return made;
    }
    await env.DB.prepare('UPDATE eval_goals SET task_id = ? WHERE id = ?').bind(id, g.id).run();
    made++;
  }
  return made;
}

/* --------------------------------------------------------------------------- meeting, acknowledgment, signature */

export async function setMeeting(env: Db, actor: Actor, caseId: string, date: string): Promise<void> {
  const c = await caseOf(env, caseId);
  const v = await viewerOf(env, actor);
  const facts = { employee: c.employee_email, supervisor: lower(c.supervisor_email) };
  if (!mayReadRaw(v, facts)) throw new HttpError(403, 'forbidden', 'Only the supervisor, HR or an administrator can set the meeting.');
  if (!isDate(date)) throw new HttpError(400, 'bad_date', 'Pick a date.');
  await env.DB.prepare('UPDATE eval_cases SET meeting_on = ?, updated_at = ? WHERE id = ?').bind(date, nowIso(), c.id).run();
}

export async function acknowledge(env: Db, actor: Actor, caseId: string, note: string, now: Date = new Date()): Promise<void> {
  const c = await caseOf(env, caseId);
  if (lower(actor.email) !== c.employee_email) throw new HttpError(403, 'forbidden', 'Only the employee acknowledges their evaluation.');
  if (c.stage !== 'meeting') throw new HttpError(409, 'not_ready', 'The summary has not been shared yet.');
  if (c.meeting_on && todayEt(now) < c.meeting_on) throw new HttpError(409, 'too_early', `You can acknowledge after the meeting on ${longDate(c.meeting_on)}.`);
  const t = nowIso();
  await env.DB.prepare("UPDATE eval_cases SET acknowledged_at = ?, acknowledged_note = ?, stage = 'acknowledged', updated_at = ? WHERE id = ?").bind(t, clip(note, 2000), t, c.id).run();
  const dir = await names(env);
  const hr = (await env.DB.prepare('SELECT email FROM hub_hr').all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }))).results || [];
  for (const h of hr) {
    await tellOnce(env, `hr-sign:${c.id}:${lower(h.email)}`, h.email, `${who(dir, c.employee_email).name}'s evaluation is ready to sign`, {
      heading: 'An evaluation is ready for your signature',
      lines: [`${who(dir, c.employee_email).name} acknowledged the ${c.period_label} evaluation. Review it and sign as HR.`], button: 'Open the evaluation', path: `/evaluations/?c=${c.id}`,
    });
  }
}

export async function sign(env: Db, actor: Actor, caseId: string): Promise<{ stage: string; docUrl: string; docError: string }> {
  const c = await caseOf(env, caseId);
  const v = await viewerOf(env, actor);
  if (!mayManage(v, { employee: c.employee_email, supervisor: lower(c.supervisor_email) })) throw new HttpError(403, 'forbidden', 'HR signs. Ask HR or a hub administrator.');
  if (c.stage !== 'acknowledged') throw new HttpError(409, 'not_ready', 'The employee has not acknowledged the evaluation yet.');
  const t = nowIso();
  await env.DB.prepare("UPDATE eval_cases SET signed_by = ?, signed_at = ?, stage = 'signed', updated_at = ? WHERE id = ?").bind(lower(actor.email), t, t, c.id).run();
  const doc = await (await import('./drive')).publish(env, c.id);
  await env.DB.prepare("UPDATE eval_cases SET stage = 'done', updated_at = ? WHERE id = ?").bind(nowIso(), c.id).run();
  return { stage: 'done', docUrl: doc.url, docError: doc.error };
}

/** Try the Google Doc again after the folder is named or access is fixed. */
export async function retryDocument(env: Db, actor: Actor, caseId: string): Promise<{ docUrl: string; docError: string }> {
  const c = await caseOf(env, caseId);
  const v = await viewerOf(env, actor);
  if (!mayManage(v, { employee: c.employee_email, supervisor: lower(c.supervisor_email) })) throw new HttpError(403, 'forbidden', 'That is for HR and hub administrators.');
  if (!c.signed_at) throw new HttpError(409, 'not_signed', 'Sign the evaluation first.');
  const doc = await (await import('./drive')).publish(env, c.id);
  return { docUrl: doc.url, docError: doc.error };
}

/* ------------------------------------------------------------------------------------------------------ reminders */

const OWE_DAYS = 2;

/** Sends each reminder once: due in 2 days, and the day after it passes. Run from the morning job or the admin button. */
export async function runNudges(env: Db, now: Date = new Date()): Promise<{ sent: number; checked: number }> {
  const today = todayEt(now);
  const dir = await names(env);
  let sent = 0;
  let checked = 0;
  const rows = (await env.DB.prepare(`${CASE_SQL} WHERE t.status = 'open' AND c.stage NOT IN ('signed','done')`).all<CaseRow>()).results || [];
  const soon = (due: string | null) => !!due && today >= addDays(due, -OWE_DAYS) && today <= due;
  const late = (due: string | null) => !!due && today > due;
  const go = async (key: string, to: string | null, subject: string, m: Parameters<typeof tell>[3]) => {
    checked++;
    if (to && (await tellOnce(env, key, to, subject, m))) sent++;
  };
  for (const c of rows) {
    const emp = who(dir, c.employee_email);
    const link = `/evaluations/?c=${c.id}`;
    if (!c.self_submitted_at || (await reviewersOf(env, c.id)).length < REVIEWERS_MIN) {
      if (soon(c.w1_due)) await go(`self-soon:${c.id}`, c.employee_email, 'Your self-assessment is due soon', { heading: 'Your self-assessment is due soon', lines: [`Finish Form A and name 3 to 5 reviewers by ${longDate(c.w1_due || '')}.`], button: 'Open my evaluation', path: link });
      if (late(c.w1_due)) await go(`self-late:${c.id}`, c.employee_email, 'Your self-assessment is past due', { heading: 'Your self-assessment is past due', lines: ['Your supervisor is waiting on it. Finish Form A and name your reviewers.'], button: 'Open my evaluation', path: link });
    }
    for (const r of await reviewersOf(env, c.id)) {
      if (r.status !== 'asked') continue;
      if (soon(c.w2_due)) await go(`rev-soon:${r.id}`, r.reviewer_email, `Feedback for ${emp.name} is due soon`, { heading: 'Feedback is due soon', lines: [`Your feedback for ${emp.name} is due ${longDate(c.w2_due || '')}.`], button: 'Give feedback', path: link });
      if (late(c.w2_due)) await go(`rev-late:${r.id}`, r.reviewer_email, `Feedback for ${emp.name} is past due`, { heading: 'Feedback is past due', lines: [`${emp.name}'s supervisor is waiting on your feedback.`], button: 'Give feedback', path: link });
    }
    if (c.supervisor_email && c.self_submitted_at && !c.summary_submitted_at) {
      if (soon(c.w3_due)) await go(`sup-soon:${c.id}`, c.supervisor_email, `Summary for ${emp.name} is due soon`, { heading: 'A summary is due soon', lines: [`Write Form C and the six-month plan for ${emp.name} by ${longDate(c.w3_due || '')}.`], button: 'Open the evaluation', path: link });
      if (late(c.w3_due)) await go(`sup-late:${c.id}`, c.supervisor_email, `Summary for ${emp.name} is past due`, { heading: 'A summary is past due', lines: [`Write Form C and the six-month plan for ${emp.name}.`], button: 'Open the evaluation', path: link });
    }
    if (c.stage === 'meeting' && c.meeting_on && today > addDays(c.meeting_on, 2)) {
      await go(`ack:${c.id}`, c.employee_email, 'Please acknowledge your evaluation', { heading: 'Acknowledge your evaluation', lines: ['Your meeting is done. Read the summary and plan, add a note if you like, and acknowledge it.'], button: 'Open my evaluation', path: link });
    }
  }
  return { sent, checked };
}

export { FORM_A, FORM_B, FORM_C };
