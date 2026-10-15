// The rules of the learner pages as plain functions and types: addresses, card lines, what a saved lesson does to the copy of the course
// on screen, and the Practice record's merged lists. No React, no window, so tests load this file directly.
import { clockTime, dayWord, mins, plural } from './shared/format';

export type LearnState = 'new' | 'started' | 'done';

export interface Card {
  kind: 'course' | 'path';
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  status: string;
  href: string;
  lessons: number;
  minutes: number;
  courses?: number;
  done: number;
  total: number;
  pct: number;
  state: LearnState;
  completed_at: string | null;
  cert?: string;
  last_at: string | null;
}

export interface AssignedCard extends Card {
  assignment_id: string;
  due_date: string | null;
  overdue: boolean;
  days_left: number | null;
  note: string;
  assigned_by: string;
  next: { id: string; title: string; kind: string } | null;
  parts?: Array<{ slug: string; title: string; pct: number; state: string }>;
}

export interface Home {
  assigned: AssignedCard[];
  continue: { kind: string; title: string; href: string; pct: number; slug: string } | null;
  in_progress: Card[];
  completed: Card[];
  stats: { assigned: number; overdue: number; due_soon: number; completed: number };
}

export interface QuizQuestion {
  id: string;
  kind: string;
  text: string;
  options: string[];
}

export interface Lesson {
  id: string;
  kind: string;
  title: string;
  ref: string;
  minutes: number;
  body: string;
  quiz?: { pass: number; questions: QuizQuestion[] };
  state: LearnState;
  position: number;
  best?: number;
  attempts?: number;
  cut?: string;
}

export interface Assignment {
  id: string;
  due_date: string | null;
  overdue: boolean;
  note: string;
  assigned_by: string;
}

export interface Course extends Card {
  lesson_list: Lesson[];
  next_id: string | null;
  assignment: Assignment | null;
  paths: Array<{ slug: string; title: string }>;
  /** Set once the whole course is done (the server's completion record). */
  completed?: unknown;
}

export interface LearnPath extends Card {
  course_list: Card[];
  next_course: { slug: string; title: string; href: string } | null;
  assignment: Assignment | null;
}

export interface Certificate {
  cert: string;
  name: string;
  email: string;
  course: string;
  completed_at: string;
}

/** What the server says about the course after a save or a quiz. */
export interface CourseAnswer {
  preview?: boolean;
  course?: { done: number; total: number; pct: number; completed: unknown } | null;
  just_completed?: boolean;
}

export const KIND: Record<string, string> = { video: 'Video', article: 'Article', doc: 'Document', page: 'Reading', clip: 'Clip', link: 'Link', quiz: 'Quiz' };

/* ------------------------------------------------------------------ addresses (every old address keeps working) */
export const courseHref = (slug: string, lessonId?: string): string => `/learn/c/?c=${encodeURIComponent(slug)}${lessonId ? '&l=' + encodeURIComponent(lessonId) : ''}`;
export const pathHref = (slug: string): string => `/learn/p/?p=${encodeURIComponent(slug)}`;
export const certHref = (slug: string): string => `/learn/certificate/?c=${encodeURIComponent(slug)}`;

/** A search value from the address as a plain string. */
export const slugOf = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/* ------------------------------------------------------------------ cards */
export function dueChip(a: { due_date: string | null; overdue: boolean; days_left: number | null }): { cls: string; text: string } | null {
  if (!a.due_date) return null;
  if (a.overdue) return { cls: 'ln-chip ln-chip--late', text: 'Late, was due ' + dayWord(a.due_date) };
  const left = a.days_left;
  return { cls: 'ln-chip ln-chip--due', text: left === 0 ? 'Due today' : left === 1 ? 'Due tomorrow' : 'Due ' + dayWord(a.due_date) };
}

export function sizeLine(c: { kind: string; courses?: number; lessons?: number; minutes: number }): string {
  const bits: string[] = [];
  if (c.kind === 'path') bits.push(plural(c.courses || 0, 'course'));
  else bits.push(plural(c.lessons || 0, 'lesson'));
  if (c.minutes) bits.push('about ' + mins(c.minutes));
  return bits.join(' · ');
}

export function progLine(c: { state: string; completed_at: string | null; total: number; done: number }): string {
  if (c.state === 'done') return c.completed_at ? 'Completed ' + dayWord(c.completed_at.slice(0, 10)) : 'Completed';
  if (!c.total) return '';
  return `${c.done} of ${plural(c.total, 'lesson')} done`;
}

export function lessonSub(l: Lesson): string {
  return [KIND[l.kind] || l.kind, l.state === 'started' && l.kind === 'video' && l.position ? 'stopped at ' + clockTime(l.position) : '', l.kind === 'quiz' && l.best != null ? `best ${l.best}%` : ''].filter(Boolean).join(' · ');
}

/** The button on a course's page and the lesson it opens. */
export function courseStart(c: Course): { cta: string; startId: string | null } {
  const started = c.state !== 'new';
  const first = c.lesson_list[0]?.id ?? null;
  return {
    cta: c.state === 'done' ? 'Review' : started ? 'Continue' : 'Start',
    startId: c.state === 'done' ? first : c.next_id || first,
  };
}

export const minutesLeft = (c: Course): number => c.lesson_list.filter((l) => l.state !== 'done').reduce((n, l) => n + l.minutes, 0);

/* ------------------------------------------------------------------ what a save does to the copy in hand */
/** Applies the server's answer about the course to the page's copy and returns the new copy (the old one is untouched). */
export function applyAnswer(c: Course, res: CourseAnswer, lessonId: string, state: LearnState | null): Course {
  if (res.preview) return c;
  const next: Course = { ...c, lesson_list: c.lesson_list.map((l) => (l.id === lessonId && state ? { ...l, state } : l)) };
  if (res.course) {
    next.done = res.course.done;
    next.total = res.course.total;
    next.pct = res.course.pct;
    if (res.course.completed) {
      next.state = 'done';
      next.completed = res.course.completed;
    } else if (next.done > 0 || next.lesson_list.some((x) => x.state !== 'new')) next.state = 'started';
  }
  return next;
}

/** The catalog's search and its state filter. */
export function catalogHit(c: Card, filter: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return (filter === 'all' || c.state === filter) && (!needle || `${c.title} ${c.summary} ${c.audience}`.toLowerCase().includes(needle));
}

/** A video resumes where the person stopped, unless the lesson is done or the spot is at the very start or end. */
export function resumeAt(l: { state: string; position: number }, duration: number): number {
  if (l.state === 'done') return 0;
  const at = l.position || 0;
  return at > 3 && at < (duration || 1e9) - 5 ? at : 0;
}

/** Drive links open in a preview frame. */
export function driveInfo(url: string): { id: string; preview: string; type: string } | null {
  const m = /(docs|drive)\.google\.com\/(document|spreadsheets|presentation|file)\/d\/([\w-]+)/.exec(url || '');
  if (!m) return null;
  const host = m[2] === 'file' ? 'drive.google.com' : 'docs.google.com';
  return { id: m[3], preview: `https://${host}/${m[2]}/d/${m[3]}/preview`, type: m[2] };
}

/** A link a lesson opens must be http or https. */
export const safeUrl = (u: string): string => (/^https?:\/\//i.test(u) ? u : '#');

/** The lesson's media address with its cut version. */
export const mediaSrc = (ref: string, ext: 'mp4' | 'jpg' | 'vtt', cut?: string): string => `/api/videos/${encodeURIComponent(ref)}.${ext}${cut ? '?v=' + encodeURIComponent(cut) : ''}`;

/* ------------------------------------------------------------------ quiz */
export interface QuizResult extends CourseAnswer {
  score: number;
  passed: boolean;
  pass: number;
  correct: number;
  total: number;
  attempts: number;
  best?: number;
  results: Array<{ id: string; correct: boolean; explain?: string; answer?: number }>;
}

/** The note under a question after a try: right or not quite, and the reason, shown for wrong answers and for every answer once passed. */
export function whyLine(r: { correct: boolean; explain?: string } | undefined, passed: boolean): string {
  return r && r.explain && (!r.correct || passed) ? (r.correct ? 'Right. ' : 'Not quite. ') + r.explain : '';
}

/* ------------------------------------------------------------------ Practice */
export const us = (iso: string): string => (iso ? iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4) : '');
export const plusDays = (iso: string, n: number): string => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const todayET = (now = new Date()): string => now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const practiceDay = (d: string): string => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric', year: 'numeric' }) : '');
export const practiceMoney = (n: number): string => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PracticeEntry {
  id: string;
  kind: 'gift' | 'call' | 'task';
  fields: Record<string, string>;
  ok: boolean;
  at: string;
}
export interface PracticeState {
  ready: boolean;
  partner: {
    id: string;
    name: string;
    household: string;
    address: string;
    phone: string;
    email: string;
    since: string;
    history: Array<{ date: string; amount: number; fund: string; type: string }>;
    notes: Array<{ date: string; text: string }>;
  };
  funds: string[];
  appeals: Array<{ code: string }>;
  giftTypes: string[];
  methods: string[];
  kinds: Array<[string, string]>;
  tags: string[];
  scenarios: Record<'gift' | 'call', { title: string; forWho: string; story: string; steps: string[] }>;
  entries: PracticeEntry[];
  done: { gift: boolean; call: boolean; task: boolean; all: boolean };
}
export interface PracticeCheck {
  label: string;
  ok: boolean;
  hint: string;
}

export function practiceHistory(D: PracticeState): Array<{ date: string; amount: number; fund: string; type: string; mine: boolean }> {
  const rows = D.partner.history.map((g) => ({ ...g, mine: false }));
  D.entries.filter((e) => e.kind === 'gift' && e.ok).forEach((e) => rows.push({ date: e.fields.date, amount: Number(e.fields.amount), fund: e.fields.fund, type: 'One-time gift', mine: true }));
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}

export function practiceNotes(D: PracticeState): Array<{ date: string; text: string; mine: boolean }> {
  const rows = D.partner.notes.map((n) => ({ ...n, mine: false }));
  D.entries
    .filter((e) => e.ok && (e.kind === 'call' || e.kind === 'task'))
    .forEach((e) =>
      rows.push({
        date: e.at.slice(0, 10),
        mine: true,
        text: e.kind === 'call' ? `Call. ${e.fields.what}` : `Task, due ${practiceDay(e.fields.due)}. ${e.fields.what}`,
      }),
    );
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}

/** The text of the Receipt amount line under the amount field. */
export const receiptAmount = (v: string): string => (v ? '$' + v.replace(/[$,]/g, '') : '$0.00');
