// Dates in Eastern time, as plain YYYY-MM-DD strings. Ported from public/js/projects/ui-util.js (same results).
export const ET = 'America/New_York';

let tdC = '';
let tdAt = 0;
export const todayStr = (): string => {
  const n = Date.now();
  if (n - tdAt > 20000) {
    tdC = new Date(n).toLocaleDateString('en-CA', { timeZone: ET });
    tdAt = n;
  }
  return tdC;
};
const parse = (s: string) => new Date(s + 'T12:00:00Z');
export const addDays = (s: string, n: number): string => new Date(parse(s).getTime() + n * 86400000).toISOString().slice(0, 10);
export const dow = (s: string): number => parse(s).getUTCDay();
export const mondayOf = (s: string): string => addDays(s, -((dow(s) + 6) % 7));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayDiff = (a: string, b: string): number => Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000);

export function dueLabel(d: string | null | undefined, time?: string | null): string {
  if (!d) return '';
  const t = todayStr();
  const n = dayDiff(d, t);
  let s: string;
  if (n === 0) s = 'Today';
  else if (n === 1) s = 'Tomorrow';
  else if (n === -1) s = 'Yesterday';
  else if (n > 1 && n < 7) s = DAY[dow(d)];
  else {
    const x = parse(d);
    s = MON[x.getUTCMonth()] + ' ' + x.getUTCDate() + (d.slice(0, 4) !== t.slice(0, 4) ? ', ' + d.slice(0, 4) : '');
  }
  if (time) {
    const [h, m] = time.split(':').map(Number);
    s += ' ' + ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM');
  }
  return s;
}
export const shortDate = (d: string | null | undefined): string => {
  if (!d) return '';
  const x = parse(d);
  return MON[x.getUTCMonth()] + ' ' + x.getUTCDate();
};
export const isOverdue = (t: { due_date: string | null; status: string }): boolean => !!(t.due_date && t.status !== 'done' && t.status !== 'dropped' && t.due_date < todayStr());

export const ago = (iso: string): string => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  const d = new Date(iso);
  return MON[d.getMonth()] + ' ' + d.getDate();
};

export const PRIORITY: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High' };
export const STATUS: Record<string, string> = { open: 'To do', doing: 'In progress', waiting: 'Waiting', done: 'Done', dropped: 'Dropped' };
export const COLOR_NAMES = ['leaf', 'sky', 'sun', 'dusk', 'terra', 'teal', 'slate'];
