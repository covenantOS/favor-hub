// The rules behind the Evaluations screens: which answers count as done, what is left before a form can be submitted, which tabs a person
// sees, the dates the way the Astro page wrote them, and the admin term picker's groups. Pure functions and types, no browser calls, so
// tests run them as they are and the page draws the same text everywhere.
import type { Form, Question, Section } from '@hub/data/evaluation-forms';

export type FormId = 'A' | 'B';

export interface Ans {
  qid: string;
  rating: number | null;
  text: string;
  example: string;
}

export interface Scale {
  value: number;
  short: string;
  label: string;
  text: string;
}

export interface Limits {
  reviewersMin: number;
  reviewersMax: number;
}

export interface FormsPayload {
  forms: Record<FormId, Form>;
  scale: Scale[];
  exampleNote: string;
  limits: Limits;
}

export interface Person {
  email: string;
  name: string;
  title: string;
  team: string;
}

export interface Who {
  email: string;
  name: string;
  title: string;
  team: string;
}

export interface Mine {
  me: { email: string; name: string };
  manage: boolean;
  hr: boolean;
  own: Array<{ id: string; term: string; period: string; stage: string; stageWord: string; next: string; due: string; self: { done: number; total: number }; reviewers: number; mine: boolean }>;
  owe: Array<{ caseId: string; employee: string; relationship: string; due: string; status: string; progress: { done: number; total: number } }>;
  team: Array<{ id: string; employee: string; period: string; stage: string; stageWord: string; next: string; due: string; self: boolean; reviewersDone: number; reviewers: number }>;
  needsSign: Array<{ id: string; employee: string; period: string }>;
  leads: Array<{ id: string; employee: string; period: string; meetingOn: string; meetingTime: string }>;
  reports: Array<{ email: string; name: string }>;
  isAdmin?: boolean;
  settings?: { summaryUrl: string; instructionsUrl: string; supervisors: Record<string, string> };
}

export interface Progress {
  done: number;
  total: number;
  optional?: number;
}

export interface Reviewer {
  email: string;
  name: string;
  relationship: string;
  frequency: string;
  status: string;
  submittedAt: string;
  declineNote?: string;
}

export interface CompetencyRow {
  id: string;
  label: string;
  category: string;
  self: number | null;
  others: number | null;
  raters: number;
  gap: number | null;
}

export interface Evidence {
  from: string;
  to: string;
  startedWithinYear: boolean;
  tasks: { done: number; late: number; recent: Array<{ title: string; doneAt: string }> };
  partners: { contacted: number; actions: number; byKind: Array<{ kind: string; n: number }> };
  courses: { done: number; list: Array<{ title: string; completedAt: string }> };
}

export interface CaseView {
  case: {
    id: string;
    term: string;
    period: string;
    stage: string;
    stageWord: string;
    due: { w1: string; w2: string; w3: string };
    meetingOn: string;
    meetingTime: string;
    meetingLink: string;
    acknowledgedAt: string;
    acknowledgedNote: string;
    signedBy: string;
    signedAt: string;
    docUrl: string;
    selfSubmitted: boolean;
    summaryShared: boolean;
    termOpen: boolean;
    employee: Who;
    supervisor: Who;
    leader: Who;
  };
  role: { employee: boolean; supervisor: boolean; reviewer: boolean; leader: boolean; manage: boolean; raw: boolean; hr: boolean };
  next: string;
  self?: { answers: Ans[]; submitted: boolean; progress: Progress };
  reviewers?: Reviewer[];
  mineB?: { answers: Ans[]; submitted: boolean; progress: Progress; relationship: string; frequency: string };
  feedback?: Array<{ reviewer: string; email: string; relationship: string; frequency: string; submitted: boolean; answers: Ans[] }>;
  analysis?: {
    rows: CompetencyRow[];
    categories: Array<{ category: string; self: number | null; others: number | null }>;
    themes: {
      strengths: CompetencyRow[];
      growth: CompetencyRow[];
      gaps: CompetencyRow[];
      words: Array<{ word: string; people: number }>;
    };
    reviewersIn: number;
  };
  final?: { templateUrl: string; instructionsUrl: string; docUrl: string; shared: boolean; editable: boolean };
  learning?: Array<{ title: string; completedAt: string }>;
  evidence?: Evidence;
  reportsToMissing?: boolean;
}

export type Answers = Record<string, Ans>;
/** The form a tab edits, and where its saved answers sit in the case view. */
export type AnswerSource = 'self' | 'mineB';
export const SOURCE_OF: Record<FormId, AnswerSource> = { A: 'self', B: 'mineB' };

/* ------------------------------------------------------------------------------------------------------------- dates */

/** "Oct 6", or "Tuesday, Oct 6" when long. Day only, read as UTC so every time zone shows the same day. */
export function dateWord(d: string | null | undefined, long = false): string {
  if (!d) return '';
  const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z');
  return x.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: long ? 'long' : undefined });
}

/** Today in Eastern time as YYYY-MM-DD (en-CA writes the date that way). */
export function todayEt(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** "October 6, 2026" in the browser's own zone: the date the form shows for its Date line. */
export function longToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* ---------------------------------------------------------------------------------------------------- answers, progress */

export const questionsOf = (form: Form): Question[] => form.sections.flatMap((s) => s.questions);

export function byId(list: Ans[] | undefined): Answers {
  const m: Answers = {};
  (list || []).forEach((a) => {
    m[a.qid] = a;
  });
  return m;
}

/** Saved answers with the person's unsaved edits on top. */
export function merged(saved: Ans[] | undefined, edits: Answers | undefined): Answers {
  return { ...byId(saved), ...(edits || {}) };
}

export function hasAnswer(a: Ans | undefined, q: Question): boolean {
  return q.kind === 'rating' ? !!a && a.rating !== null && a.rating !== undefined : !!(a && String(a.text || '').trim());
}

const needsExample = (a: Ans | undefined): boolean => !!a && (a.rating === 1 || a.rating === 2) && !String(a.example || '').trim();

export function secProgress(sec: Section, m: Answers): { done: number; total: number } {
  let done = 0;
  let total = 0;
  sec.questions.forEach((q) => {
    if (q.kind === 'auto') return;
    const req = q.kind === 'rating' || q.kind === 'choice' || q.req;
    const a = m[q.id];
    if (req) {
      total++;
      if (hasAnswer(a, q) && !(q.kind === 'rating' && needsExample(a))) done++;
    }
  });
  return { done, total };
}

export interface Gap {
  si: number;
  q: Question;
  why: string;
}

/** What is left before the form can be submitted, in the order the form asks it. */
export function gapsOf(form: Form, m: Answers): Gap[] {
  const g: Gap[] = [];
  form.sections.forEach((sec, si) => {
    sec.questions.forEach((q) => {
      if (q.kind === 'auto') return;
      const a = m[q.id];
      if (q.kind === 'rating') {
        if (!hasAnswer(a, q)) g.push({ si, q, why: 'Rate this' });
        else if (needsExample(a)) g.push({ si, q, why: 'Add an example' });
      } else if (q.kind === 'choice') {
        if (!hasAnswer(a, q)) g.push({ si, q, why: 'Choose one' });
      } else if (q.req && !hasAnswer(a, q)) g.push({ si, q, why: 'Answer this' });
    });
  });
  return g;
}

export function totalsOf(form: Form, m: Answers): { done: number; total: number } {
  let done = 0;
  let total = 0;
  form.sections.forEach((s) => {
    const p = secProgress(s, m);
    done += p.done;
    total += p.total;
  });
  return { done, total };
}

export const percent = (done: number, total: number): number => Math.round((100 * done) / Math.max(1, total));

/** The label on a gap in the submit box: "Rate this: 4. Question text up to 70 characters...". */
export function gapLabel(x: Gap): string {
  return x.why + ': ' + (x.q.n ? x.q.n + '. ' : '') + x.q.text.slice(0, 70) + (x.q.text.length > 70 ? '...' : '');
}

/* ------------------------------------------------------------------------------------------------------------- tabs */

export type Tab = 'overview' | 'self' | 'evidence' | 'reviewers' | 'final' | 'feedback' | 'compare' | 'mine';

export function tabsFor(v: CaseView): Array<[Tab, string]> {
  const t: Array<[Tab, string]> = [['overview', 'Overview']];
  const r = v.role;
  if (r.employee) {
    t.push(['self', 'Self-assessment']);
    if (v.evidence) t.push(['evidence', 'My year']);
    t.push(['reviewers', 'Reviewers']);
    if (v.case.meetingOn || v.case.summaryShared) t.push(['final', 'Meeting and final evaluation']);
  } else if (r.raw) {
    if (v.self) t.push(['self', 'Self-assessment']);
    if (v.evidence) t.push(['evidence', 'Evidence']);
    t.push(['feedback', 'Feedback']);
    t.push(['compare', 'Compare']);
    t.push(['final', 'Meeting and final evaluation']);
  }
  if (v.mineB) t.push(['mine', 'My feedback form']);
  return t;
}

/** The tab shown: the one in the address when this person has it, else the first one (a reviewer with only Form B opens it). */
export function tabShown(v: CaseView, wanted: string): Tab {
  const tabs = tabsFor(v);
  if (tabs.some((t) => t[0] === wanted)) return wanted as Tab;
  return !v.role.employee && !v.role.raw && v.mineB ? 'mine' : 'overview';
}

export const STEPS = (due: { w1: string; w2: string; w3: string }) => [
  { label: 'Week 1', text: 'Self-evaluation and feedback', due: due.w1 },
  { label: 'Week 2', text: 'Review meeting and final evaluation', due: due.w2 },
];

/** Where the stepper stands: the step number now, and whether every step is done. Feedback stays in week 1 until its due date passes. */
export function stepNow(stage: string, w1Due = '', today = ''): { cur: number; done: boolean } {
  const late = !!w1Due && !!today && today > w1Due;
  return { cur: stage === 'self' ? 1 : stage === 'feedback' ? (late ? 2 : 1) : 2, done: stage === 'signed' || stage === 'done' };
}

/* ---------------------------------------------------------------------------------------------------------- compare */

export const barWidth = (x: number | null): number => (x === null ? 0 : Math.round((x / 5) * 100));
export const num = (x: number | null | undefined): string => (x === null || x === undefined ? 'n/a' : x.toFixed(1));
export const gapText = (g: number | null): string => (g === null ? '' : (g > 0 ? '+' : '') + g.toFixed(1));
export const isBigGap = (g: number | null): boolean => g !== null && Math.abs(g) >= 1;

export function rowsByCategory(rows: CompetencyRow[]): Array<[string, CompetencyRow[]]> {
  const cats = new Map<string, CompetencyRow[]>();
  rows.forEach((r) => cats.set(r.category, [...(cats.get(r.category) || []), r]));
  return [...cats.entries()];
}

/* ----------------------------------------------------------------------------------------------------- reviewer picker */

export const activeReviewers = (list: Reviewer[]): Reviewer[] => list.filter((x) => x.status === 'asked' || x.status === 'submitted');

export function reviewerHits(staff: Person[], pick: string[], q: string, employeeEmail: string): Person[] {
  const needle = q.trim().toLowerCase();
  return staff
    .filter((p) => p.email !== employeeEmail && !pick.includes(p.email) && (!needle || (p.name + ' ' + p.team + ' ' + p.title).toLowerCase().includes(needle)))
    .slice(0, 12);
}

/** The line under the Ask button: why it is off. */
export function askHint(n: number, lim: Limits): string {
  return n < lim.reviewersMin ? 'Choose at least ' + lim.reviewersMin + '. Your supervisor counts as one.' : n > lim.reviewersMax ? 'No more than ' + lim.reviewersMax + '.' : '';
}

/** The supervisor is always one of the reviewers: put them first when they are missing from the chosen list. */
export function withSupervisor(list: string[], supervisor: string): string[] {
  return supervisor && !list.includes(supervisor) ? [supervisor, ...list] : list;
}

/** A clock time such as 14:30 in words, Eastern. */
export function timeWord(t: string): string {
  const m = /^(\d\d):(\d\d)$/.exec(t || '');
  if (!m) return '';
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM') + ' Eastern';
}

/* ---------------------------------------------------------------------------------------------------------- admin */

export interface PickPerson {
  email: string;
  name: string;
  title: string;
  team: string;
  startDate: string;
  hasSupervisor: boolean;
  open: boolean;
}

export type StartGroup = 'first' | 'second' | 'unknown';

/** People who started January to June go first; July to December second; no start date last. */
export function groupOf(p: { startDate?: string }): StartGroup {
  const m = Number((p.startDate || '').slice(5, 7));
  return !m ? 'unknown' : m <= 6 ? 'first' : 'second';
}

export const GROUPS: Array<[StartGroup, string]> = [
  ['first', 'Started January to June'],
  ['second', 'Started July to December'],
  ['unknown', 'No start date recorded'],
];

/** The people a term opens with at first: January to June starters who have no open evaluation. */
export function firstPicked(people: PickPerson[]): Record<string, boolean> {
  const sel: Record<string, boolean> = {};
  people.forEach((p) => {
    if (groupOf(p) === 'first' && !p.open) sel[p.email] = true;
  });
  return sel;
}

export function visiblePeople(people: PickPerson[], q: string): Array<[StartGroup, string, PickPerson[]]> {
  const needle = q.trim().toLowerCase();
  return GROUPS.map(([g, label]) => [g, label, people.filter((p) => groupOf(p) === g && (!needle || (p.name + ' ' + p.team).toLowerCase().includes(needle)))] as [StartGroup, string, PickPerson[]]).filter((x) => x[2].length);
}

/** Shift-click: every box from the last one ticked to this one takes this one's state. Disabled people are skipped. */
export function rangeSelect(order: PickPerson[], last: string, to: string, on: boolean, sel: Record<string, boolean>): Record<string, boolean> {
  const live = order.filter((p) => !p.open);
  const i = live.findIndex((p) => p.email === last);
  const j = live.findIndex((p) => p.email === to);
  if (i < 0 || j < 0) return sel;
  const out = { ...sel };
  for (let n = Math.min(i, j); n <= Math.max(i, j); n++) out[live[n].email] = on;
  return out;
}

export const pickedCount = (sel: Record<string, boolean>): number => Object.keys(sel).filter((k) => sel[k]).length;

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/* ---------------------------------------------------------------------------------------------------------- address */

export { validateEvalSearch, validateAdminSearch, type EvalSearch, type AdminSearch } from '../../lib/route-search';
import type { EvalSearch } from '../../lib/route-search';

/** A case address as the old page wrote it: /evaluations/?c=ID&v=tab. */
export function caseHref(id: string, v = ''): string {
  return '/evaluations/?c=' + encodeURIComponent(id) + (v ? '&v=' + v : '');
}
