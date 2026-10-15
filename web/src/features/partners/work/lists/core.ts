// Shared by the Work Center list tabs (Gifts to thank, My partners, Asks, Cadence, My week, Grants): the read and write helpers the
// classic work.js and thank.js had, the person's role, the date words, and small hooks for state that must not touch the browser while drawing.
import { queryOptions } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { hubGet } from '../../../../lib/hub';

/** A read of /api/work. as is the admin's ?as=<email> view, passed through unchanged. */
export const workPath = (path: string, as?: string) => (as ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(as) : path);
export const workGet = <T = any>(path: string, as?: string) => hubGet(workPath(path, as)) as Promise<T>;

export class WorkError extends Error {
  status = 0;
  data: any = null;
}

/** The ?as= value in the address, read in the browser only. */
export const asOf = () => (typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('as') || '');

/** A write (or a read the page makes after it has drawn): the hub's request header, a message on failure. */
export async function workApi<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(workPath(path, asOf()), { method: opts.method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers, body });
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401 && data.error === 'signin') {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    throw new WorkError('Sign in again.');
  }
  if (!res.ok || data.ok === false) {
    const e = new WorkError(data.message || 'Something went wrong. Try again.');
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data as T;
}
export const workPost = <T = any>(path: string, body?: unknown) => workApi<T>(path, { method: 'POST', body: body ?? {} });

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const reqId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ------------------------------------------------------------------ who is asking */

export interface WorkMe {
  role: string;
  label?: string;
  fid: string | null;
  team: string;
  all?: boolean;
  canDelete?: boolean;
  canMove?: boolean;
  canEntry?: boolean;
  canGifts?: boolean;
  anyTeam?: boolean;
  fids?: string[];
  canPartnerEdit?: boolean;
}
export interface WorkContext {
  me: WorkMe;
  today: string;
  synced: string;
}
/** The person's role and the Work Center's date, from a one-row read of the board (the same answer the classic page took them from). */
export const contextQuery = (as?: string) =>
  queryOptions({
    queryKey: ['work', 'context', as || ''],
    queryFn: async (): Promise<WorkContext> => {
      const d = await workGet('/api/work/board?limit=1', as);
      return { me: d.me, today: d.today, synced: d.synced };
    },
    staleTime: 5 * 60_000,
  });

/* ------------------------------------------------------------------ words and numbers */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep 5" in the current year, "Sep 5, 2024" otherwise. yr forces the year. */
export const dateWords = (iso: string | null | undefined, today: string, yr?: boolean) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return MON[m - 1] + ' ' + d + (yr || String(y) !== today.slice(0, 4) ? ', ' + y : '');
};
export const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const dowOf = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay();
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayLabel = (ymd: string, today: string) => WDAY[dowOf(ymd)] + ' ' + dateWords(ymd, today);
export const plural = (n: number, one: string, many?: string) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many || one + 's');
/** Dollars with cents only when the amount has them. */
export const moneyExact = (a: number | null | undefined) => {
  const n = Number(a) || 0;
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
};
export const moneyWhole = (a: number | null | undefined) => {
  const n = Math.round(Number(a) || 0);
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US');
};
export const moneyShort = (v: number | null | undefined) => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  const f = (x: number) => String(+x.toFixed(1));
  return a >= 999950000 ? s + '$' + f(a / 1e9) + 'B' : a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + (a < 1e5 ? f(a / 1000) : Math.round(a / 1000)) + 'K' : moneyWhole(n);
};
export const telHref = (n: string) => 'tel:' + String(n).replace(/[^\d+]/g, '');
export const initialsOf = (n: string) =>
  String(n || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase() || '?';

/* ------------------------------------------------------------------ state that lasts while the page stays open */

// The classic tabs kept their filters in script variables, so leaving a tab and coming back found them as they were. This keeps the same
// promise for the React tabs: a value is held per key for the life of the page. Drawing on the server starts from the initial value.
const held = new Map<string, unknown>();
const firsts = new Map<string, unknown>();
const subs = new Set<() => void>();
export function useHeld<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  // The first initial value is kept, so a snapshot read twice in one draw is the same object.
  if (!firsts.has(key)) firsts.set(key, initial);
  const first = firsts.get(key) as T;
  const get = () => (held.has(key) ? (held.get(key) as T) : first);
  const v = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    get,
    () => first
  );
  const set = (n: T | ((p: T) => T)) => {
    const next = typeof n === 'function' ? (n as (p: T) => T)(get()) : n;
    held.set(key, next);
    subs.forEach((f) => f());
  };
  return [v, set];
}

/** True on a phone-width screen (860 px and under), false while drawing on the server and in the first browser frame. */
export function usePhone(): boolean {
  const [p, setP] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 860px)');
    const on = () => setP(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return p;
}
/** Read at the moment of a press, never while drawing. */
export const onPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;

/** The clock's "now", refreshed every minute and never set while the server draws. */
export function useMinute(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(Date.now());
    const t = setInterval(() => setN(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return n;
}
