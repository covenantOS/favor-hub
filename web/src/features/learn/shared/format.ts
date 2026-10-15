// Small formatters Learn pages share. Dates are written with explicit parts so the server copy and the browser copy of a page read the
// same (no locale-dependent spacing).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ET = 'America/New_York';

/** 2026-10-15 -> Oct 15. */
export function dayWord(ymd: string): string {
  const [, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return (MON[m - 1] || '') + ' ' + d;
}

/** An ISO time as October 15, 2026, in Eastern time. */
export function longDay(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(t);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return `${MONTH[get('month') - 1]} ${get('day')}, ${get('year')}`;
}

export const plural = (n: number, one: string, many?: string): string => n + ' ' + (n === 1 ? one : many || one + 's');

export const mins = (m: number): string => (m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');

/** 125 seconds -> 2:05. */
export function clockTime(s: number): string {
  const n = Math.max(0, Math.round(s));
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}
