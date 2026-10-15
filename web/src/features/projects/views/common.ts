// Shared helpers for the Calendar, Timeline and Workload views. Ported from public/js/projects/views-common.js (same results).
// Dates are plain YYYY-MM-DD strings. Day math runs on whole-day numbers in UTC so a time zone or a clock change never shifts a day.
// Pure TypeScript: nothing here reads window or document.
import type { Task } from '../types';
import { todayStr } from '../lib/dates';

const DAY_MS = 86400000;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON3 = MONTHS.map((m) => m.slice(0, 3));
export const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
/** A day number is NaN when a task has no date. */
export const has = (n: number): boolean => n === n;

/** Whole-day number (days since 1970-01-01) for a YYYY-MM-DD string, or NaN. */
export function dn(str: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
  if (!m) return NaN;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}
export const ymd = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const parts = (n: number): { y: number; m: number; d: number; dow: number } => {
  const d = new Date(n * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
};
export const dayOfWeek = (n: number): number => new Date(n * DAY_MS).getUTCDay();
export const mkDn = (y: number, m: number, d: number): number => Math.round(Date.UTC(y, m, d) / DAY_MS);
export const startOfWeek = (n: number): number => n - dayOfWeek(n);

/** Today in Eastern time as a day number (the team works on Eastern dates). */
export const todayDn = (): number => dn(todayStr());

export function fmtShort(n: number): string {
  const p = parts(n);
  return MON3[p.m] + ' ' + p.d;
}
export function fmtLong(n: number): string {
  const p = parts(n);
  return DOW3[p.dow] + ', ' + MON3[p.m] + ' ' + p.d;
}
export function fmtRange(a: number, b: number): string {
  if (!has(a) && !has(b)) return '';
  if (!has(a)) return fmtShort(b);
  if (!has(b) || a === b) return fmtShort(a);
  const pa = parts(a);
  const pb = parts(b);
  return pa.m === pb.m ? MON3[pa.m] + ' ' + pa.d + ' to ' + pb.d : fmtShort(a) + ' to ' + fmtShort(b);
}

/* ---------------------------------------------------------------- tasks */

export interface Span {
  s: number;
  d: number;
  both: boolean;
}
type Dated = Pick<Task, 'start_date' | 'due_date'>;

/** The start and due day numbers of a task, ordered. A task with one date has start === due. NaN when it has none. */
export function span(t: Dated): Span {
  const s = dn(t.start_date);
  const d = dn(t.due_date);
  if (has(s) && has(d)) return s <= d ? { s, d, both: true } : { s: d, d: s, both: true };
  if (has(d)) return { s: d, d, both: false };
  if (has(s)) return { s, d: s, both: false };
  return { s: NaN, d: NaN, both: false };
}
export const isDone = (t: Pick<Task, 'status' | 'done_at'>): boolean => t.status === 'done' || t.status === 'dropped' || !!t.done_at;
export const isOpen = (t: Pick<Task, 'status' | 'done_at'>): boolean => !isDone(t);
export function isOverdue(t: Pick<Task, 'status' | 'done_at' | 'due_date'>): boolean {
  if (!isOpen(t)) return false;
  const d = dn(t.due_date);
  return has(d) && d < todayDn();
}

const COLORS = new Set(['leaf', 'sun', 'teal', 'dusk', 'sky', 'slate', 'terra']);
export const colorOf = (token: string | null | undefined): string => (token && COLORS.has(token) ? token : 'slate');
const PEOPLE_COLORS = ['teal', 'leaf', 'dusk', 'sky', 'sun', 'terra', 'slate'];
export function hashColor(s: string | null | undefined): string {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PEOPLE_COLORS[h % PEOPLE_COLORS.length];
}
export function initials(name: string | null | undefined, email: string | null | undefined): string {
  const n = String(name || '').trim();
  if (n) return n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return String(email || '?')[0].toUpperCase();
}

/** Plural-aware "3 tasks". */
export const taskCount = (n: number): string => n + (n === 1 ? ' task' : ' tasks');

/** The workload colour step for a count of tasks in a week. */
export const heat = (n: number): number => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 8 ? 3 : 4);

/** The ordering the timeline uses inside a group: dated before undated, earliest start, earliest end, then manual order. */
export function spanCmp(a: Task, b: Task): number {
  const sa = span(a);
  const sb = span(b);
  const aa = has(sa.s);
  const bb = has(sb.s);
  if (aa !== bb) return aa ? -1 : 1;
  if (aa && sa.s !== sb.s) return sa.s - sb.s;
  if (aa && sa.d !== sb.d) return sa.d - sb.d;
  return (a.sort || 0) - (b.sort || 0);
}

/** The date fields to write when a task moves to start..due. A task with one date keeps writing that one field. */
export function datePatch(t: Pick<Task, 'start_date' | 'due_date'>, s: number, d: number, both: boolean): Record<string, string> {
  if (both) return { start_date: ymd(s), due_date: ymd(d) };
  return t.due_date || !t.start_date ? { due_date: ymd(d) } : { start_date: ymd(s) };
}

/** The date fields to write when a task is dropped on a day. grabDay is the day of the chip that was grabbed (null: its first day). */
export function movePatch(t: Pick<Task, 'start_date' | 'due_date'>, grabDay: number | null, dropDay: number): Record<string, string> {
  const sp = span(t);
  if (!has(sp.s)) return { due_date: ymd(dropDay) };
  if (sp.both) {
    const dlt = dropDay - (grabDay == null ? sp.s : grabDay);
    return { start_date: ymd(sp.s + dlt), due_date: ymd(sp.d + dlt) };
  }
  return t.due_date || !t.start_date ? { due_date: ymd(dropDay) } : { start_date: ymd(dropDay) };
}

/** Adding "succ depends on pred" is a cycle when pred already depends (through any chain) on succ. */
export function wouldCycle(deps: Map<string, Set<string>>, pred: string, succ: string): boolean {
  const seen = new Set<string>();
  const stack = [pred];
  while (stack.length) {
    const x = stack.pop() as string;
    if (x === succ) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    const ps = deps.get(x);
    if (ps) for (const p of ps) stack.push(p);
  }
  return false;
}

/* ---------------------------------------------------------------- timeline geometry */

export type Pt = [number, number];

/** A polyline with rounded corners as an svg path. */
export function roundedPath(pts: Pt[], r: number): string {
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = cx + ((px - cx) / (l1 || 1)) * rr;
    const ay = cy + ((py - cy) / (l1 || 1)) * rr;
    const bx = cx + ((nx - cx) / (l2 || 1)) * rr;
    const by = cy + ((ny - cy) / (l2 || 1)) * rr;
    d += ' L' + ax + ',' + ay + ' Q' + cx + ',' + cy + ' ' + bx + ',' + by;
  }
  const last = pts[pts.length - 1];
  return d + ' L' + last[0] + ',' + last[1];
}

/** The points of a dependency line from the end of one bar (ax, ay) to the start of the next (bx, by). */
export function edgePts(ax: number, ay: number, bx: number, by: number, rowH: number): Pt[] {
  const gap = 12;
  if (Math.abs(by - ay) < 1) return [[ax, ay], [bx, by]];
  if (bx - ax >= gap * 2) return [[ax, ay], [ax + gap, ay], [ax + gap, by], [bx, by]];
  const dir = by > ay ? 1 : -1;
  const midY = ay + dir * (rowH / 2);
  return [[ax, ay], [ax + gap, ay], [ax + gap, midY], [bx - gap, midY], [bx - gap, by], [bx, by]];
}

export const msgOf = (e: unknown): string => {
  const x = e as { message?: string; error?: string } | null;
  return (x && (x.message || x.error)) || 'Could not save. Try again.';
};
