// Words and numbers for Reports. Dates are built by hand (never toLocaleString), so the server's text and the browser's text are the same
// character for character whatever ICU build each runs on.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const money = (n: unknown): string => {
  const x = Number(n) || 0;
  return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const num = (n: unknown): string => Number(n).toLocaleString('en-US');

/** Oct 5, 2026 from 2026-10-05 (or a stamp that starts with it); anything else as it came. */
export const dshort = (s: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  // A date the calendar does not have (month 13) prints as it came; one that rolls over (Feb 31) prints the day it lands on, as Date does.
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return Number.isNaN(t.getTime()) || +m[2] < 1 || +m[2] > 12 ? s : `${MON[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
};

export const pct = (n: unknown): string => (Number(n) * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
