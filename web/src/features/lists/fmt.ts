// Numbers and dates for the Lists pages, in the words public/js/favor-ui.js gives the classic pages (money drops the cents of a whole
// number, a day carries its year only when it is not this year, "when" says Today or Yesterday). Everything is built by hand, never with
// toLocaleTimeString, so the server's text and the browser's text are the same characters whatever ICU build each runs on.
// Pure: no imports, so tests load it directly.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const num = (n: number | string): string => Number(n).toLocaleString('en-US');

/** $1,234 for a whole number, $1,234.50 when the number has cents (FavorUI.money). Empty for null and ''. */
export function money(a: unknown): string {
  if (a == null || a === '') return '';
  const n = Number(a);
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
}

interface Parts { y: string; mo: number; d: number; h: number; mi: string }
function eastern(d: Date): Parts {
  const p: Record<string, string> = {};
  for (const x of ET.formatToParts(d)) p[x.type] = x.value;
  return { y: p.year, mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: p.minute };
}
const key = (p: Parts) => `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const asDate = (iso: unknown): Date | null => {
  const d = iso instanceof Date ? iso : /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(iso + 'T12:00:00Z') : new Date(String(iso));
  return Number.isNaN(d.getTime()) ? null : d;
};

export const todayEt = (now: Date = new Date()): string => key(eastern(now));

/** Oct 12, with the year only when it is not this year. Takes 2026-10-12 or a timestamp (read as the Eastern day). */
export function day(iso: unknown, now: Date = new Date()): string {
  const d = asDate(iso);
  if (!d) return '';
  const k = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? String(iso) : key(eastern(d));
  const [y, m, dd] = k.split('-').map(Number);
  return `${MON[m - 1]} ${dd}${String(y) !== todayEt(now).slice(0, 4) ? ', ' + y : ''}`;
}

/** 9:44 AM in Eastern time. */
export function time(iso: unknown): string {
  const d = asDate(iso);
  if (!d) return '';
  const e = eastern(d);
  return `${e.h % 12 || 12}:${e.mi} ${e.h < 12 ? 'AM' : 'PM'}`;
}

/** Today 9:44 AM, Yesterday 9:44 AM, Oct 11 9:44 AM (FavorUI.when). */
export function when(iso: unknown, now: Date = new Date()): string {
  const d = asDate(iso);
  if (!d) return '';
  const k = key(eastern(d));
  const t = todayEt(now);
  const y = key(eastern(new Date(Date.parse(t + 'T12:00:00Z') - 864e5)));
  return (k === t ? 'Today' : k === y ? 'Yesterday' : day(iso, now)) + ' ' + time(d);
}
