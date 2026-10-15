// Learn, Manage and the course editor: the pure rules (words, dates, ordering, the assign form, the quiz editor, the report) with no React
// in them, so they are unit-tested on their own (tests/learn-admin-web.test.mjs). Ported from public/js/learn-admin.js.

export type Status = 'draft' | 'published' | 'archived';
export type LessonKind = 'video' | 'article' | 'doc' | 'page' | 'clip' | 'link' | 'quiz';

export const STATUS: Record<string, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
export const KIND: Record<string, string> = { video: 'Video', article: 'Article', doc: 'Document', page: 'Written page', clip: 'Clip', link: 'Link', quiz: 'Quiz' };
export const COLORS = ['leaf', 'teal', 'sky', 'sun', 'dusk', 'terra', 'slate'] as const;
export const REPORT_STATUS: Record<string, string> = { done: 'Done', overdue: 'Late', in_progress: 'In progress', not_started: 'Not started' };

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  status: Status;
  lessons: number;
  minutes: number;
  completions: number;
  assigned: number;
  done: number;
  updated_at?: string;
}
export interface PathSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  status: Status;
  courses: string[];
  assigned: number;
  done: number;
  updated_at?: string;
}
export interface Overview {
  courses: CourseSummary[];
  paths: PathSummary[];
}

export interface Question {
  id: string;
  kind: 'choice' | 'tf';
  text: string;
  options: string[];
  answer: number;
  explain: string;
}
export interface Quiz {
  pass: number;
  questions: Question[];
}
export interface Lesson {
  id: string;
  kind: LessonKind;
  title: string;
  ref: string;
  minutes: number;
  body: string;
  quiz?: Quiz;
}
export interface Course {
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  status: Status;
  lessons: Lesson[];
  open_assignments: number;
  completions: number;
}

export interface Person {
  email: string;
  name: string;
  team: string;
  title: string;
}
export interface People {
  people: Person[];
  teams: string[];
}

export interface ReportRow {
  assignment_id: string;
  email: string;
  name: string;
  team: string;
  kind: string;
  title: string;
  slug: string;
  href: string;
  due_date: string | null;
  status: 'done' | 'overdue' | 'in_progress' | 'not_started';
  pct: number;
  last_at: string | null;
  completed_at: string | null;
  best_score: number | null;
}
export interface Report {
  summary: { assigned: number; done: number; in_progress: number; not_started: number; overdue: number; avg_score: number | null };
  teams: string[];
  rows: ReportRow[];
}

/* ------------------------------------------------------------------------------------------------ words and dates */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 9" from 2026-10-09 (or a longer timestamp), the same on the server and in the browser. */
export const dayWord = (ymd: string): string => {
  const [, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return (MON[m - 1] || '') + ' ' + d;
};
export const plural = (n: number, one: string, many?: string): string => n + ' ' + (n === 1 ? one : many || one + 's');
/** Today in Eastern time as YYYY-MM-DD. */
export const todayEt = (now: Date = new Date()): string => now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const addDays = (ymd: string, n: number): string => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const mins = (m: number): string => (m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');

/* ------------------------------------------------------------------------------------------------ lists */

const STATUS_ORDER: Record<string, number> = { published: 0, draft: 1, archived: 2 };
/** Courses on the Manage page: published first, then drafts, then archived, each by name. */
export const sortCourses = (list: CourseSummary[]): CourseSummary[] => list.slice().sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title));
export const sortPaths = (list: PathSummary[]): PathSummary[] => list.slice().sort((a, b) => a.title.localeCompare(b.title));

/** The line under a lesson's name: its kind, how many questions a quiz has, and the address of a document or link. */
export const lessonMeta = (l: Lesson): string =>
  [KIND[l.kind] || l.kind, l.kind === 'quiz' && l.quiz ? plural(l.quiz.questions.length, 'question') : '', l.kind === 'doc' || l.kind === 'link' ? l.ref.replace(/^https?:\/\//, '').slice(0, 48) : ''].filter(Boolean).join(' · ');

/** A new order of ids with the item at `from` moved so it sits at `to` (a drop onto another row). */
export function dropOrder(ids: string[], from: number, to: number): string[] {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids.slice();
  const out = ids.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}
/** The arrow buttons: swap two neighbours. */
export function swapOrder<T>(list: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list.slice();
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
/** A course's lessons put in the order of `ids` (the screen shows a move before the server answers). */
export function reorderLessons(lessons: Lesson[], ids: string[]): Lesson[] {
  const by = new Map(lessons.map((l) => [l.id, l]));
  const out = ids.map((id) => by.get(id)).filter((l): l is Lesson => !!l);
  return out.length === lessons.length ? out : lessons;
}

/* ------------------------------------------------------------------------------------------------ the assign form */

export type Who = 'people' | 'team' | 'everyone';
export interface AssignForm {
  target: string;
  who: Who;
  team: string;
  emails: string[];
  due: string;
  note: string;
}
export const blankAssign = (): AssignForm => ({ target: '', who: 'people', team: '', emails: [], due: '', note: '' });

/** The "Course or path" menu: published paths, then published courses. */
export const assignTargets = (o: Overview): [string, string][] => [
  ...o.paths.filter((p) => p.status === 'published').map((p): [string, string] => ['path:' + p.id, 'Path: ' + p.title]),
  ...o.courses.filter((c) => c.status === 'published').map((c): [string, string] => ['course:' + c.id, 'Course: ' + c.title]),
];

/** The target the address names (?course=, ?path=); a path wins when both are there, as on the Astro page. */
export function targetFromSearch(s: { course?: string; path?: string }): string {
  let t = '';
  if (s.course) t = 'course:' + s.course;
  if (s.path) t = 'path:' + s.path;
  return t;
}

/** People shown in the picker: whoever matches the typed words in name, team or title, at most 80. */
export function matchPeople(people: Person[], needle: string): Person[] {
  const n = needle.trim().toLowerCase();
  return people.filter((p) => !n || `${p.name} ${p.team} ${p.title}`.toLowerCase().includes(n)).slice(0, 80);
}

/** How many people the form reaches. */
export function assignCount(people: Person[], a: AssignForm): number {
  return a.who === 'everyone' ? people.length : a.who === 'team' ? people.filter((p) => p.team === a.team).length : a.emails.length;
}

/** What is missing before Assign can send, in the order the Astro page checked. Empty means ready. */
export function assignProblem(a: AssignForm, targetOk: boolean): string {
  if (!targetOk || !a.target.includes(':') || !a.target.split(':')[1]) return 'Choose a course or a path.';
  if (a.who === 'people' && !a.emails.length) return 'Pick at least one person.';
  if (a.who === 'team' && !a.team) return 'Choose a team.';
  return '';
}

/** The body the assign route takes. */
export function assignBody(a: AssignForm): Record<string, unknown> {
  const [kind, ...rest] = a.target.split(':');
  return { kind, target: rest.join(':'), emails: a.who === 'people' ? a.emails : undefined, team: a.who === 'team' ? a.team : undefined, everyone: a.who === 'everyone', due_date: a.due || null, note: a.note };
}

export interface AssignResult {
  created?: number;
  reopened?: number;
  updated?: number;
  already_done?: number;
  told?: number;
  tasks?: number;
}
/** The sentence under the form after an assignment. */
export function assignSummary(r: AssignResult): string {
  const bits: string[] = [];
  if (r.created) bits.push(`${plural(r.created, 'person', 'people')} assigned`);
  if (r.reopened) bits.push(`${r.reopened} given again`);
  if (r.updated) bits.push(`${r.updated} updated`);
  if (r.already_done) bits.push(`${r.already_done} had already finished it`);
  const tail: string[] = [];
  if (r.told) tail.push(`${r.told} told`);
  if (r.tasks) tail.push(`${plural(r.tasks, 'task')} added in Projects`);
  return (bits.join(', ') || 'Nothing changed') + (tail.length ? '. ' + tail.join(', ') : '') + '.';
}

/* ------------------------------------------------------------------------------------------------ the report */

export interface ReportFilters {
  course: string;
  path: string;
  team: string;
  status: string;
  q: string;
}
export const blankFilters = (): ReportFilters => ({ course: '', path: '', team: '', status: '', q: '' });
/** The query string the report route reads. */
export const reportQs = (f: ReportFilters): string =>
  Object.entries(f)
    .filter(([, v]) => v)
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&');
/** The value of the "Learning" menu for these filters ("p:slug" for a path, "c:slug" for a course). */
export const learningValue = (f: ReportFilters): string => (f.path ? 'p:' + f.path : f.course ? 'c:' + f.course : '');
/** The filters after a pick in the "Learning" menu. */
export function pickLearning(f: ReportFilters, value: string): ReportFilters {
  return { ...f, course: value.startsWith('c:') ? value.slice(2) : '', path: value.startsWith('p:') ? value.slice(2) : '' };
}

const cell = (v: unknown): string => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
/** The report as a CSV file's text, every cell quoted, lines ending in CRLF. */
export function reportCsv(rows: ReportRow[]): string {
  const head = ['Person', 'Team', 'Learning', 'Type', 'Due', 'Status', 'Percent', 'Quiz score', 'Last activity', 'Completed'].map(cell).join(',');
  const lines = rows.map((x) => [x.name, x.team, x.title, x.kind, x.due_date || '', REPORT_STATUS[x.status], x.pct, x.best_score == null ? '' : x.best_score, x.last_at ? x.last_at.slice(0, 10) : '', x.completed_at ? x.completed_at.slice(0, 10) : ''].map(cell).join(','));
  return [head, ...lines].join('\r\n');
}
export const csvName = (today: string): string => `learning-report-${today}.csv`;

/* ------------------------------------------------------------------------------------------------ the quiz editor */

export const blankQuestion = (n: number): Question => ({ id: 'q' + n, kind: 'choice', text: '', options: ['', ''], answer: 0, explain: '' });
export const blankQuiz = (): Quiz => ({ pass: 80, questions: [blankQuestion(1)] });
export const cloneQuiz = (q: Quiz): Quiz => JSON.parse(JSON.stringify(q)) as Quiz;

/** Switching a question between multiple choice and true or false. */
export function changeKind(x: Question, kind: 'choice' | 'tf'): Question {
  const out = { ...x, kind };
  if (kind === 'tf') {
    out.options = ['True', 'False'];
    out.answer = Math.min(x.answer, 1);
  } else if (x.options.length < 2 || x.options[0] === 'True') {
    out.options = ['', ''];
    out.answer = 0;
  }
  return out;
}
/** Remove one answer; the right answer stays on the same text. */
export function removeOption(x: Question, j: number): Question {
  const options = x.options.filter((_, k) => k !== j);
  let answer = x.answer;
  if (answer === j) answer = 0;
  else if (answer > j) answer--;
  return { ...x, options, answer };
}
/**
 * The quiz as saved: ids q1, q2 and so on, the pass mark (80 when the box is empty or zero), and blank answers dropped from a multiple choice
 * question with the right answer still pointing at the same text.
 */
export function cleanQuizForSave(q: Quiz, passRaw: string | number): Quiz {
  const pass = +passRaw || 80;
  const questions = q.questions.map((x, i) => {
    if (x.kind !== 'choice') return { ...x, id: 'q' + (i + 1) };
    const keep: number[] = [];
    x.options.forEach((o, j) => {
      if (o.trim()) keep.push(j);
    });
    const options = keep.map((j) => x.options[j].trim());
    const at = keep.indexOf(x.answer);
    return { ...x, id: 'q' + (i + 1), options, answer: at >= 0 ? at : 0 };
  });
  return { pass, questions };
}

/* ------------------------------------------------------------------------------------------------ adding lessons */

export interface HelpItem {
  kind: 'video' | 'article';
  ref: string;
  title: string;
  summary: string;
  hay: string;
}
const slugOf = (url: string): string => String(url).replace(/\/+$/, '').split('/').pop() || '';
/** The help library's search index as lesson candidates: a video or an article, with the words a search looks through. */
export function helpItems(raw: unknown): HelpItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i: Record<string, unknown>) => {
    const video = i.kind === 'video';
    return {
      kind: video ? 'video' : 'article',
      ref: slugOf(String(i.url || '')),
      title: String(i.title || ''),
      summary: String(i.summary || ''),
      hay: `${i.title} ${i.summary} ${i.topic || ''} ${video ? i.text || '' : ''}`.toLowerCase(),
    } as HelpItem;
  });
}
/** Help results for a search: at most 12 of each kind for a typed search, 8 when the box is empty. */
export function helpHits(items: HelpItem[], q: string, kind: 'video' | 'article'): HelpItem[] {
  const needle = q.trim().toLowerCase();
  return items.filter((h) => h.kind === kind && (!needle || h.hay.includes(needle))).slice(0, needle ? 12 : 8);
}

/** A pasted address is a document when it points at Google Docs or Drive, a plain link otherwise. */
export const urlKind = (url: string): 'doc' | 'link' => (/^https:\/\/(docs|drive)\.google\.com\//i.test(url.trim()) ? 'doc' : 'link');
export const urlLessonBody = (url: string, title: string): { kind: 'doc' | 'link'; ref: string; title: string } => {
  const u = url.trim();
  const kind = urlKind(u);
  return { kind, ref: u, title: title || (kind === 'doc' ? 'Google document' : 'Link') };
};
