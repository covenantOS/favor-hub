// Recurring gifts: the page's rules, kept free of React so the tests can run them. Filters, paging, dates and the words on a status.
import type { RecurringRow } from '@shared/schemas';
import { money0, money2 } from '@/lib/format';

export type FilterId = 'active' | 'declined' | 'stopped' | 'held' | 'twoyears' | 'card' | 'bank' | 'pastdue' | 'pastend' | 'stopped90';

export interface Chip {
  id: FilterId;
  label: string;
}

const gone = (s: string) => /terminat|cancel|complet/i.test(s);
const isActive = (r: RecurringRow) => r.status === 'Active';

export const FILTERS: Record<FilterId, (r: RecurringRow) => boolean> = {
  active: isActive,
  declined: (r) => isActive(r) && r.flags.declined,
  stopped: (r) => gone(r.status),
  held: (r) => /held/i.test(r.status),
  twoyears: (r) => isActive(r) && r.flags.twoYears,
  card: (r) => isActive(r) && r.method === 'Card',
  bank: (r) => isActive(r) && r.method === 'Bank',
  pastdue: (r) => isActive(r) && r.flags.pastDue,
  pastend: (r) => isActive(r) && r.flags.pastEnd,
  stopped90: (r) => r.flags.stopped90,
};

export const CHIP_LABELS: [FilterId, string][] = [
  ['active', 'Active'],
  ['declined', 'Declined'],
  ['stopped', 'Stopped'],
  ['held', 'Held'],
  ['twoyears', 'Giving 2+ years'],
  ['card', 'Card'],
  ['bank', 'Bank'],
  ['pastdue', 'Past due'],
  ['pastend', 'Past end date'],
  ['stopped90', 'Stopped in 90 days'],
];

/** Counts for each chip over every row. Past due and past end date only draw while there is something in them. */
export function chipCounts(rows: RecurringRow[]): Chip[] & { counts: Record<FilterId, number> } {
  const counts = {} as Record<FilterId, number>;
  for (const [id] of CHIP_LABELS) counts[id] = rows.filter(FILTERS[id]).length;
  const chips = CHIP_LABELS.filter(([id]) => (id === 'pastdue' || id === 'pastend' || id === 'stopped90' ? counts[id] > 0 : true)).map(([id, label]) => ({ id, label }));
  return Object.assign(chips, { counts });
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Rows for one chip and a name search. Stopped rows read newest stop first; the rest keep the server's order (declines, then largest). */
export function visibleRows(rows: RecurringRow[], filter: FilterId, search: string): RecurringRow[] {
  const q = norm(search);
  let out = rows.filter(FILTERS[filter]);
  if (q) out = out.filter((r) => norm(r.name).includes(q) || r.id === q.replace(/\s/g, '') || r.cid === q.replace(/\s/g, ''));
  if (filter === 'stopped' || filter === 'stopped90') out = out.slice().sort((a, b) => (a.statusDate < b.statusDate ? 1 : a.statusDate > b.statusDate ? -1 : b.amount - a.amount));
  return out;
}

export const ROWS_CHOICES = [15, 25, 50];

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The page numbers to draw: first, last, the ones around the current page, and a gap marker (0) between. */
export function pageList(page: number, pages: number): number[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(0);
    out.push(n);
  });
  return out;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 27", with the year when it is not this year. Empty for no date and for Blackbaud's empty date. */
export function shortDate(iso: string, today: string): string {
  if (!iso || iso.startsWith('1900')) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return MON[m - 1] + ' ' + d + (String(y) === today.slice(0, 4) ? '' : ', ' + y);
}

export const amount = (n: number) => (Number.isInteger(n) ? money0(n) : money2(n));

export interface StatusWord {
  text: string;
  tone: 'ok' | 'bad' | 'warn' | 'quiet';
}

/** The words on a row's status pill. A decline that a later payment cleared reads as Active. */
export function statusWord(r: RecurringRow, today: string): StatusWord {
  if (gone(r.status)) return { text: (/complet/i.test(r.status) ? 'Completed' : 'Stopped') + (r.statusDate ? ' ' + shortDate(r.statusDate, today) : ''), tone: 'quiet' };
  if (/held/i.test(r.status)) return { text: 'Held', tone: 'warn' };
  if (r.flags.pastDue) return { text: r.daysLate === 1 ? 'Past due 1 day' : `Past due ${r.daysLate} days`, tone: 'bad' };
  if (r.flags.pastEnd) return { text: 'Past end date', tone: 'warn' };
  if (r.flags.declined && !r.declineRecovered) return { text: 'Declined ' + shortDate(r.declinedOn, today), tone: 'bad' };
  return { text: 'Active', tone: 'ok' };
}

/** "Mar, Apr and 10 others" is noise; the title on the dots names the months paid. */
export function monthsTitle(months: boolean[], today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const names: string[] = [];
  months.forEach((paid, i) => {
    if (!paid) return;
    const d = new Date(Date.UTC(y, m - 1 - (months.length - 1 - i), 1));
    names.push(MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear());
  });
  return names.length ? 'Paid in ' + names.join(', ') : 'No payment in the last 12 months';
}

/** A dollar amount typed in a field: "$1,500", "1500.50". Null when it is not a number or is outside $1 to $250,000. */
export function parseAmount(v: string): number | null {
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 1 || n > 250000) return null;
  return Math.round(n * 100) / 100;
}

export const methodLine = (r: RecurringRow) => `${amount(r.amount)}${r.frequencyLabel ? ' ' + r.frequencyLabel : ''}${r.method ? ' by ' + r.method.toLowerCase() : ''}`;

/** What a chip or a number counts, shown on hover. Dates are Eastern. A paid installment is a payment above $0, so a declined charge never counts. */
export const HINTS = {
  twoyears: 'Active schedules whose first paid installment was two or more years ago. Counted from the first payment above $0, not from the start date.',
  paid30: 'Active schedules with at least one paid installment (a payment above $0, so declined charges do not count) in the last 30 days, by Eastern dates. The dollars are the sum of those installments.',
  declined: 'Active schedules with a declined charge since July 1. A schedule stays here after a later payment goes through, and the row says so.',
  stopped90: 'Schedules stopped in the last 90 days that had a paid installment in the 180 days before.',
} as const;

/** Next charge one cycle on, for the confirm line. Mirrors the Blackbaud route (a month end stays a month end). */
export function addCycle(ymd: string, frequency: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return '';
  const f = frequency.toUpperCase();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (f === 'WEEKLY') return new Date(Date.UTC(y, mo - 1, d + 7)).toISOString().slice(0, 10);
  const add = ({ MONTHLY: 1, QUARTERLY: 3, ANNUALLY: 12 } as Record<string, number>)[f];
  if (!add) return '';
  const last = new Date(Date.UTC(y, mo - 1 + add + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo - 1 + add, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Columns and rows for Open in Google Sheets: the rows the person is looking at, all pages. */
export function sheetTabs(rows: RecurringRow[], today: string) {
  const columns = [
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'cid', label: 'Partner record', type: 'id' },
    { key: 'amount', label: 'Amount', type: 'money' },
    { key: 'frequency', label: 'How often', type: 'text' },
    { key: 'method', label: 'Method', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'next', label: 'Next charge', type: 'date' },
    { key: 'lastPaid', label: 'Last paid', type: 'date' },
    { key: 'paid', label: 'Paid installments', type: 'int' },
    { key: 'paid12', label: 'Paid, last 12 months', type: 'int' },
    { key: 'holder', label: 'Held by', type: 'text' },
    { key: 'fund', label: 'Fund', type: 'text' },
    { key: 'start', label: 'Started', type: 'date' },
    { key: 'declinedOn', label: 'Last decline', type: 'date' },
    { key: 'reason', label: 'Decline reason', type: 'text' },
  ];
  return [
    {
      name: 'Schedules',
      columns,
      rows: rows.map((r) => ({
        partner: r.name, cid: r.cid, amount: r.amount, frequency: r.frequencyLabel, method: r.method, status: statusWord(r, today).text, next: r.status === 'Active' ? r.next : '', lastPaid: r.lastPaid,
        paid: r.paid, paid12: r.paid12, holder: r.holder, fund: r.fund, start: r.start, declinedOn: r.declinedOn, reason: r.declineReason,
      })),
    },
  ];
}
