// Meetings view math: Eastern days, Sunday weeks, month grids, stepping. Pure functions (typed copy of public/js/meet/views.js, which the
// classic pages and tests/meet-views.test.mjs still use). Change both while the classic page stays.
export type View = 'day' | 'week' | 'month';
export const TZ = 'America/New_York';
const fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
type Parts = Record<string, number>;
function parts(ms: number): Parts {
  const o: Parts = {};
  fmtParts.formatToParts(new Date(ms)).forEach((p) => {
    o[p.type] = +p.value;
  });
  return o;
}
const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => y + '-' + pad(m) + '-' + pad(d);
/** The Eastern calendar day of an instant, as YYYY-MM-DD. */
export function etKey(ms: number): string {
  const p = parts(ms);
  return key(p.year, p.month, p.day);
}
/** Eastern hour (0 to 23) and minute of an instant. */
export function etHM(ms: number): { h: number; m: number } {
  const p = parts(ms);
  return { h: p.hour % 24, m: p.minute };
}
const split = (k: string): [number, number, number] => {
  const a = k.split('-');
  return [+a[0], +a[1], +a[2]];
};
const utc = (k: string) => {
  const a = split(k);
  return new Date(Date.UTC(a[0], a[1] - 1, a[2]));
};
const fromUtc = (d: Date) => key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
export function addDays(k: string, n: number): string {
  const d = utc(k);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}
/** The instant of 12:00 AM Eastern on a day. */
export function etStart(k: string): number {
  const a = split(k);
  for (let off = 4; off <= 5; off++) {
    const t = Date.UTC(a[0], a[1] - 1, a[2], off);
    const p = parts(t);
    if (key(p.year, p.month, p.day) === k && p.hour % 24 === 0) return t;
  }
  return Date.UTC(a[0], a[1] - 1, a[2], 5);
}
export const dow = (k: string): number => utc(k).getUTCDay();
/** The Sunday that starts the week holding the day. */
export const weekStart = (k: string): string => addDays(k, -dow(k));
export function weekDays(k: string): string[] {
  const s = weekStart(k);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(addDays(s, i));
  return out;
}
/** Weeks (Sunday first) that cover the month holding the day; 4 to 6 rows of 7 days. */
export function monthGrid(k: string): { key: string; inMonth: boolean }[][] {
  const a = split(k);
  const first = key(a[0], a[1], 1);
  const last = fromUtc(new Date(Date.UTC(a[0], a[1], 0)));
  let s = weekStart(first);
  const rows: { key: string; inMonth: boolean }[][] = [];
  while (s <= last) {
    const row: { key: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(s, i);
      row.push({ key: d, inMonth: d.slice(0, 7) === first.slice(0, 7) });
    }
    rows.push(row);
    s = addDays(s, 7);
  }
  return rows;
}
export function addMonths(k: string, n: number): string {
  const a = split(k);
  const t = a[0] * 12 + (a[1] - 1) + n;
  const y = Math.floor(t / 12);
  const m = (t % 12) + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return key(y, m, Math.min(a[2], dim));
}
/** One arrow press: a day, a week or a month. */
export const step = (view: View, k: string, dir: number): string => (view === 'month' ? addMonths(k, dir) : addDays(k, view === 'week' ? 7 * dir : dir));
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = (s: string) => s.slice(0, 3);
export function dayName(k: string, full?: boolean): string {
  const n = DAY[dow(k)];
  return full === false ? short(n) : n;
}
export function monthName(k: string, full?: boolean): string {
  const n = MON[split(k)[1] - 1];
  return full === false ? short(n) : n;
}
/** The header: "Monday, October 12", "Oct 11 to 17", "October 2026". */
export function title(view: View, k: string): string {
  const a = split(k);
  if (view === 'month') return monthName(k) + ' ' + a[0];
  if (view === 'week') {
    const d = weekDays(k);
    const s = split(d[0]);
    const e = split(d[6]);
    return s[1] === e[1] ? short(MON[s[1] - 1]) + ' ' + s[2] + ' to ' + e[2] : short(MON[s[1] - 1]) + ' ' + s[2] + ' to ' + short(MON[e[1] - 1]) + ' ' + e[2];
  }
  return dayName(k) + ', ' + monthName(k) + ' ' + a[2];
}
/** Meetings by Eastern start day. */
export function bucket<T extends { start: number }>(evs: T[]): Record<string, T[]> {
  const o: Record<string, T[]> = {};
  evs.forEach((e) => {
    const k = etKey(e.start);
    (o[k] = o[k] || []).push(e);
  });
  return o;
}
/** At most `max` chips for a month cell and how many are left over. */
export function chips<T>(list: T[], max: number): { shown: T[]; more: number } {
  return list.length > max ? { shown: list.slice(0, max - 1), more: list.length - (max - 1) } : { shown: list, more: 0 };
}
/** Every day key a view shows, first to last. */
export function range(view: View, k: string): string[] {
  if (view === 'day') return [k];
  if (view === 'week') return weekDays(k);
  const out: string[] = [];
  monthGrid(k).forEach((r) => r.forEach((c) => out.push(c.key)));
  return out;
}
export const dayNum = (k: string): number => split(k)[2];
