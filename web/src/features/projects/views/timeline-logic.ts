// The pure parts of the Timeline: the day range, the rows (groups, tasks, the add row), and the window of rows on screen.
// Ported from public/js/projects/timeline.js. Nothing here touches the window.
import type { Section, Task } from '../types';
import { has, mkDn, parts, span, spanCmp, startOfWeek, todayDn } from './common';

export type Zoom = 'day' | 'week' | 'month';
export type GroupBy = 'section' | 'owner' | 'none';
export const ZOOMS: Zoom[] = ['day', 'week', 'month'];
/** Pixels per day at each zoom. */
export const ZOOM_W: Record<Zoom, number> = { day: 44, week: 18, month: 5.5 };

export interface Cfg {
  leftW: number;
  rowH: number;
  barH: number;
  headH: number;
  phone: boolean;
}
export const CFG_DESK: Cfg = { leftW: 320, rowH: 40, barH: 24, headH: 64, phone: false };
export const CFG_PHONE: Cfg = { leftW: 136, rowH: 52, barH: 30, headH: 64, phone: true };

export interface Range {
  min: number;
  max: number;
}

/** The days the chart covers: every dated task, at least 4 weeks back and 12 weeks ahead of today, padded, and wide enough at Month zoom. */
export function computeRange(tasks: Task[], td = todayDn()): Range {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of tasks) {
    const sp = span(t);
    if (has(sp.s)) {
      lo = Math.min(lo, sp.s);
      hi = Math.max(hi, sp.d);
    }
  }
  lo = Math.min(lo, td - 28);
  hi = Math.max(hi, td + 84);
  const min = startOfWeek(lo - 14);
  let max = hi + 21;
  // at least a full screen of days at the loosest zoom, so Month zoom never shows a stub
  const need = Math.ceil(2400 / ZOOM_W.month);
  if (max - min < need) max = min + need;
  return { min, max };
}

export interface Grp {
  key: string;
  label: string;
  tasks: Task[];
  sectionId: string | null;
  lo: number;
  hi: number;
  n: number;
}
export type Row = { k: 'g'; g: Grp } | { k: 't'; t: Task; depth: number } | { k: 'a'; key: string };

function groupOf(t: Task, group: GroupBy): { key: string; label: string } {
  if (group === 'section') return { key: t.section_id || '', label: t.section || 'No section' };
  if (group === 'owner') return { key: t.owner ? t.owner.email : '', label: t.owner ? t.owner.name || t.owner.email : 'Unassigned' };
  return { key: '', label: '' };
}

/** The rows down the left: a header per group (unless Group is None), its tasks and their subtasks, and the add row where one is open. */
export function buildRows(items: Task[], group: GroupBy, sections: Section[], collapsed: Set<string>, addAt: { key: string } | null): { rows: Row[]; rowIdx: Map<string, number> } {
  const ids = new Set(items.map((t) => t.id));
  const kids = new Map<string, Task[]>();
  const tops: Task[] = [];
  for (const t of items) {
    if (t.parent_id && ids.has(t.parent_id)) {
      const l = kids.get(t.parent_id);
      if (l) l.push(t);
      else kids.set(t.parent_id, [t]);
    } else tops.push(t);
  }
  const groups = new Map<string, Grp>();
  const order: string[] = [];
  if (group === 'section') {
    for (const sec of sections) {
      groups.set(sec.id, { key: sec.id, label: sec.name, tasks: [], sectionId: sec.id, lo: Infinity, hi: -Infinity, n: 0 });
      order.push(sec.id);
    }
  }
  for (const t of tops) {
    const g = groupOf(t, group);
    if (!groups.has(g.key)) {
      groups.set(g.key, { key: g.key, label: g.label, tasks: [], sectionId: group === 'section' ? g.key || null : null, lo: Infinity, hi: -Infinity, n: 0 });
      order.push(g.key);
    }
    (groups.get(g.key) as Grp).tasks.push(t);
  }
  let keys = order;
  if (group === 'owner') keys = order.slice().sort((a, b) => (a === '' ? 1 : b === '' ? -1 : (groups.get(a) as Grp).label.localeCompare((groups.get(b) as Grp).label)));
  else if (group === 'section') keys = order.filter((k) => k !== '').concat(order.includes('') ? [''] : []);
  const rows: Row[] = [];
  for (const k of keys) {
    const g = groups.get(k) as Grp;
    g.tasks.sort(spanCmp);
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    const flat: { k: 't'; t: Task; depth: number }[] = [];
    for (const t of g.tasks) {
      flat.push({ k: 't', t, depth: 0 });
      const ch = (kids.get(t.id) || []).slice().sort(spanCmp);
      for (const c of ch) flat.push({ k: 't', t: c, depth: 1 });
    }
    for (const r of flat) {
      n++;
      const sp = span(r.t);
      if (has(sp.s)) {
        lo = Math.min(lo, sp.s);
        hi = Math.max(hi, sp.d);
      }
    }
    g.lo = lo;
    g.hi = hi;
    g.n = n;
    if (group !== 'none') rows.push({ k: 'g', g });
    if (!collapsed.has(g.key)) {
      for (const r of flat) rows.push(r);
      if (addAt && addAt.key === g.key) rows.push({ k: 'a', key: g.key });
    }
  }
  if (group === 'none' && addAt) rows.push({ k: 'a', key: '' });
  const rowIdx = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.k === 't') rowIdx.set(r.t.id, i);
  });
  return { rows, rowIdx };
}

/** The first and last row to draw: the ones on screen and four more each way. */
export function rowWindow(scrollTop: number, viewH: number, headH: number, rowH: number, count: number): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / rowH) - 4);
  const last = Math.min(count - 1, Math.ceil((scrollTop + viewH - headH) / rowH) + 4);
  return { first, last };
}

/** The months of a day range as { y, m, ms, me } (first and last day number of each), for the tick rows. */
export function monthsBetween(d0: number, d1: number): { y: number; m: number; ms: number; me: number }[] {
  const out: { y: number; m: number; ms: number; me: number }[] = [];
  const p = parts(d0);
  let y = p.y;
  let m = p.m;
  for (;;) {
    const ms = mkDn(y, m, 1);
    const me = mkDn(y, m + 1, 1) - 1;
    if (ms > d1) break;
    out.push({ y, m, ms, me });
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

