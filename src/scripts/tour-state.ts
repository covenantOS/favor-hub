// What each person has seen of the tours, and when FavorOS may open one by itself. No page code here: the browser, the
// server and the tests all use these rules.
//
// An item is the core tour ("core"), a release ("r:2026-10-11", which carries the snooze for its walkthroughs) or one
// feature's walkthrough ("f:2026-10-11.chat").
//
// The rules: a tour opens by itself until it is done. Skip for now puts it off until the next working day. It comes
// back three times. After that it never opens by itself again, and waits as a number on Help and a card on Today.

export type ItemState = {
  /** offered: shown in the list. snoozed: Skip for now. done: finished. queued: an admin sent it again. */
  s: 'offered' | 'snoozed' | 'done' | 'queued';
  /** How many times it was skipped. */
  n: number;
  /** Stays closed until this day, YYYY-MM-DD in Eastern time. */
  until?: string;
  /** When this last changed, ISO. */
  at: string;
};

export type Progress = Record<string, ItemState>;

/** A tour comes back this many times after the first skip. */
export const RETURNS = 3;

export const ITEM = /^(core|r:\d{4}-\d{2}-\d{2}|f:\d{4}-\d{2}-\d{2}\.[a-z0-9-]{1,40})$/;

export const etToday = (now = new Date()): string => now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** The next Monday to Friday after a day. */
export function nextWorkingDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  do t.setUTCDate(t.getUTCDate() + 1);
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return t.toISOString().slice(0, 10);
}

/** "tomorrow" or the weekday name, for the line under Skip for now. */
export function dayWord(until: string, today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  if (until === next) return 'tomorrow';
  const [uy, um, ud] = until.split('-').map(Number);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(uy, um - 1, ud)).getUTCDay()];
}

export const isDone = (p: Progress, item: string): boolean => p[item]?.s === 'done';

/** May FavorOS open this group (the core tour or a release) by itself today? */
export function mayOpen(p: Progress, group: string, today: string): boolean {
  const g = p[group];
  if (!g) return true;
  if (g.s === 'done') return false;
  if (g.n > RETURNS) return false;
  return !g.until || today >= g.until;
}

/** Will it open by itself again after this skip? */
export const comesBack = (p: Progress, group: string): boolean => (p[group]?.n || 0) < RETURNS;

export function skip(p: Progress, group: string, today: string, at = new Date().toISOString()): Progress {
  const n = (p[group]?.n || 0) + 1;
  return { ...p, [group]: { s: 'snoozed', n, until: nextWorkingDay(today), at } };
}

export function finish(p: Progress, item: string, at = new Date().toISOString()): Progress {
  return { ...p, [item]: { s: 'done', n: p[item]?.n || 0, at } };
}

export function offer(p: Progress, items: string[], at = new Date().toISOString()): Progress {
  const out = { ...p };
  for (const i of items) if (!out[i]) out[i] = { s: 'offered', n: 0, at };
  return out;
}

/** An admin sends a tour again: it is no longer done, and its skips start over. */
export function requeue(p: Progress, item: string, at = new Date().toISOString()): Progress {
  return { ...p, [item]: { s: 'queued', n: 0, at } };
}

const clean = (v: unknown): ItemState | null => {
  const o = v as Partial<ItemState> | null;
  if (!o || typeof o !== 'object') return null;
  if (o.s !== 'offered' && o.s !== 'snoozed' && o.s !== 'done' && o.s !== 'queued') return null;
  const at = typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at).toISOString() : '';
  if (!at) return null;
  const n = Math.max(0, Math.min(99, Math.round(Number(o.n) || 0)));
  const until = typeof o.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.until) ? o.until : undefined;
  return until ? { s: o.s, n, until, at } : { s: o.s, n, at };
};

/** Keep only well-formed rows for known item names. */
export function cleanProgress(raw: unknown): Progress {
  const out: Progress = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ITEM.test(k)) continue;
    const c = clean(v);
    if (c) out[k] = c;
  }
  return out;
}

/**
 * Two copies of one person's progress (this browser and the server, or two browsers) become one. The newer row wins,
 * with two exceptions: done is never undone by an older or a lesser row, and only "queued" (Send again) undoes done.
 */
export function merge(a: Progress, b: Progress): Progress {
  const out: Progress = { ...a };
  for (const [k, y] of Object.entries(b)) {
    const x = out[k];
    if (!x) { out[k] = y; continue; }
    const newer = y.at > x.at ? y : x;
    const older = newer === y ? x : y;
    if (older.s === 'done' && newer.s !== 'done' && newer.s !== 'queued') out[k] = older;
    else out[k] = newer;
  }
  return out;
}
