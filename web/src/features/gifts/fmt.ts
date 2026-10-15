// Number and date words for the Gifts pages. The same rules public/js/gifts-home.js used: cents in, Eastern dates, no clock read while drawing
// (the page's own "today" comes from the answer, so the server's text and the browser's first render match).
export const money = (c: number | null | undefined, whole?: boolean): string => {
  if (c == null) return '';
  const d = c / 100;
  return '$' + d.toLocaleString('en-US', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTHS = MON;

/** Oct 13 from YYYY-MM-DD. */
export const short = (ymd: string | null | undefined): string => {
  if (!ymd) return '';
  const p = String(ymd).slice(0, 10).split('-').map(Number);
  return MON[p[1] - 1] + ' ' + p[2];
};

export const dow = (ymd: string): string => DOW[new Date(String(ymd).slice(0, 10) + 'T12:00:00Z').getUTCDay()];

const ET = { timeZone: 'America/New_York' } as const;
const etDay = (d: Date) => d.toLocaleDateString('en-CA', ET);

/** A time on the page's own day reads "today 9:36 AM"; an earlier day adds the date, "Oct 13, 8:02 AM". `today` is the answer's Eastern date. */
export const when = (iso: string | null | undefined, today: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const t = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', ...ET });
  return etDay(d) === today ? 'today ' + t : d.toLocaleString('en-US', { month: 'short', day: 'numeric', ...ET }) + ', ' + t;
};

// ---- the FavorUI helpers the Online gifts page used (public/js/favor-ui.js): whole-dollar or cents money, "Oct 13" (with the year when it is not
// this one), a clock time in Eastern.
/** Dollars, not cents: $1,234 when whole, $1,234.50 when not. */
export const dollars = (a: number | string | null | undefined): string => {
  if (a == null || a === '') return '';
  const n = Number(a);
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
};

/** The Eastern calendar day today, YYYY-MM-DD. Used only for "is this today" and "is this this year". */
export const todayEt = (): string => etDay(new Date());

const asDate = (v: string): Date | null => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(v + 'T12:00:00Z') : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/** Oct 13, or Oct 13, 2025 when the year is not this one. */
export const dayLabel = (v: string | null | undefined): string => {
  if (!v) return '';
  const d = asDate(v);
  if (!d) return '';
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : etDay(d);
  const p = key.split('-').map(Number);
  return MON[p[1] - 1] + ' ' + p[2] + (String(p[0]) !== todayEt().slice(0, 4) ? ', ' + p[0] : '');
};

/** 9:36 AM in Eastern. */
export const timeOf = (v: string | null | undefined): string => {
  if (!v) return '';
  const d = asDate(v);
  return d ? d.toLocaleTimeString('en-US', { ...ET, hour: 'numeric', minute: '2-digit' }) : '';
};
