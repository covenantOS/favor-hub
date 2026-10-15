// Words and dates for Reporting > Highlights. Dates are built by hand (never toLocaleString), so the server's text and the browser's text
// are the same character for character whatever ICU build each runs on.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (iso: string) => /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));

/** Oct 8 from 2026-10-08. */
export const shortDay = (iso: string): string => {
  const m = parts(iso);
  return m ? `${MON[+m[2] - 1]} ${+m[3]}` : '';
};

/** October 8, 2026 from 2026-10-08. */
export const longDay = (iso: string): string => {
  const m = parts(iso);
  return m ? `${MONTH[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
};

export const money0 = (n: number): string => (Number(n) < 0 ? '-$' : '$') + Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-US');

/** "$12.8M", "$450K", "$812": the year-end estimate (the same rule as FavorUI.short in public/js/favor-ui.js). */
export function short(v: unknown): string {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  const f = (x: number) => String(+x.toFixed(1));
  return a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + f(a / 1e3) + 'K' : s + '$' + Math.round(a);
}

/** "Jun 3" from a stamp, in Eastern time. */
export const etDay = (iso: string): string => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).formatToParts(t)) p[x.type] = x.value;
  return `${MON[+p.month - 1]} ${+p.day}`;
};

/** When a pin was asked: "just now", "3 hours ago", or the day. Read after mount only (it depends on the clock). */
export function askedAt(iso: string, now: number): string {
  const h = (now - new Date(iso).getTime()) / 36e5;
  return h < 1 ? 'just now' : h < 24 ? Math.round(h) + ' hours ago' : etDay(iso);
}

/** What a failed read says: the server's own sentence, the connection message when the request never arrived, or the page's own words. */
export const failText = (e: unknown, fallback: string): string => {
  const x = e as { name?: string; message?: string } | null;
  if (x && x.name === 'HubReadError' && x.message && x.message !== 'Something went wrong. Try again.') return x.message;
  if (x && x.name !== 'HubReadError') return 'FavorOS could not be reached. Check the connection and try again.';
  return fallback;
};
