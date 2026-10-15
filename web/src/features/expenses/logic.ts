// The rules behind the expense screens: money and dates the way the Astro pages wrote them, the mileage calculator, the request form's
// checks and payload, and the log's filter. Pure functions, no browser calls, so server and browser draw the same text.

export interface ExpenseItem {
  description: string;
  item: string;
  amount_cents: number;
}

export interface ExpenseEvent {
  kind: string;
  actor: string;
  created_at: string;
  payload?: string;
}

export interface ExpenseRequest {
  id: string;
  doc_number: string;
  status: 'pending' | 'approved' | 'declined' | string;
  requester_name: string;
  requester_email: string;
  approver_name: string;
  approvers?: string[];
  travel_dates: string;
  travel_city: string;
  reason: string;
  total_cents: number;
  items: ExpenseItem[];
  submitted_at: string;
  decided_at?: string | null;
  decline_note?: string | null;
  requester_signature?: string | null;
  approver_signature?: string | null;
  /** The log's list leaves the pictures out and says whether each exists; Detail fetches one when the row opens. */
  requester_signed?: boolean;
  approver_signed?: boolean;
  pdf?: string | null;
  can_review?: boolean;
  events?: ExpenseEvent[];
}

export const money = (cents: number): string => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dollars = (n: number): string => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ET = 'America/New_York';

/** "Oct 6, 2026". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Oct 6, 2026, 3:04 PM ET", with plain spaces so the server's text and the browser's text are the same characters. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value || '';
  return `${p('month')} ${p('day')}, ${p('year')}, ${p('hour')}:${p('minute')} ${p('dayPeriod')} ET`;
}

export const STATUS: Record<string, string> = { pending: 'Waiting', approved: 'Approved', declined: 'Declined' };
export const statusWord = (s: string): string => STATUS[s] || s;

export const MY_EVENTS: Record<string, string> = { submitted: 'Submitted', approved: 'Approved and signed', declined: 'Declined', approver_reassigned: 'Approver changed' };
export const LOG_EVENTS: Record<string, string> = {
  submitted: 'Submitted',
  approver_resolved: 'Approver assigned',
  approver_notified: 'Approver emailed',
  approved: 'Approved and signed',
  declined: 'Declined',
  decline_notified: 'Requester emailed',
  distributed: 'Approval emailed out',
  approver_reassigned: 'Approver changed',
};

/** The request form's amount box: dollars with or without $ and commas; anything else counts as nothing. */
export function parseAmount(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(/[$,]/g, ''));
  return isFinite(n) && n >= 0 ? n : 0;
}

export interface FormLine {
  description?: string;
  item?: string;
  amount?: string;
}

export const lineTotal = (lines: FormLine[]): number => lines.reduce((s, l) => s + parseAmount(l.amount), 0);

export interface Mileage {
  rate_cents: number;
  deduction_miles: number;
}
export const DEFAULT_MILEAGE: Mileage = { rate_cents: 76, deduction_miles: 40 };

export function mileageCalc(milesText: string, m: Mileage) {
  const miles = parseAmount(milesText);
  const net = Math.max(0, miles - m.deduction_miles);
  return { miles, net, amount: net * (m.rate_cents / 100) };
}

export function mileageNote(milesText: string, m: Mileage): string {
  const c = mileageCalc(milesText, m);
  return `Per policy, the first ${m.deduction_miles} mi of a trip do not count. ${c.miles} mi driven − ${m.deduction_miles} mi = ${c.net} reimbursable mi × ${dollars(m.rate_cents / 100)}/mi = ${dollars(c.amount)}.`;
}

export function mileageLine(milesText: string, m: Mileage): Required<FormLine> | null {
  const c = mileageCalc(milesText, m);
  if (c.miles <= 0) return null;
  return {
    description: `Mileage: ${c.miles} mi driven − ${m.deduction_miles} mi policy deduction = ${c.net} mi @ ${dollars(m.rate_cents / 100)}/mi`,
    item: 'Mileage',
    amount: c.amount.toFixed(2),
  };
}

export interface FormValues {
  name: string;
  email: string;
  dates: string;
  city: string;
  reason: string;
  affirm: boolean;
  lines: FormLine[];
  hasSignature: boolean;
}

/** What is still missing from the request form, in the words the page lists. */
export function missingFields(v: FormValues): string[] {
  const missing: string[] = [];
  if (!v.name.trim()) missing.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) missing.push('a valid email');
  if (lineTotal(v.lines) <= 0) missing.push('at least one expense amount');
  if (!v.reason.trim()) missing.push('the reason');
  if (!v.affirm) missing.push('the affirmation');
  if (!v.hasSignature) missing.push('your signature');
  return missing;
}

/** The body POST /api/expenses takes. */
export function requestBody(v: FormValues, signature: string | null, honeypot: string) {
  return {
    name: v.name.trim(),
    email: v.email.trim(),
    travel_dates: v.dates.trim(),
    travel_city: v.city.trim(),
    reason: v.reason.trim(),
    affirm: true,
    signature,
    company: honeypot,
    items: v.lines
      .map((l) => ({ description: (l.description || '').trim(), item: (l.item || '').trim(), amount: parseAmount(l.amount) }))
      .filter((l) => l.description || l.item || l.amount > 0),
  };
}

export const STEP_TITLES = ['You and the trip', 'What it costs', 'Why it is needed', 'Sign and send'] as const;

export type LogFilter = { status: 'all' | 'pending' | 'approved' | 'declined'; q: string };
export const FILTERS: Array<[LogFilter['status'], string]> = [['all', 'All'], ['pending', 'Waiting'], ['approved', 'Approved'], ['declined', 'Declined']];

export function filterRows(rows: ExpenseRequest[], f: LogFilter): ExpenseRequest[] {
  const q = f.q.toLowerCase();
  return rows.filter((r) => {
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (!q) return true;
    return [r.doc_number, r.requester_name, r.requester_email, r.approver_name].join(' ').toLowerCase().indexOf(q) !== -1;
  });
}

export const filterCount = (rows: ExpenseRequest[], status: LogFilter['status']): number => rows.filter((r) => status === 'all' || r.status === status).length;

export { reviewTarget } from '../../lib/route-search';

export interface EventPayload {
  to?: string[];
  sent?: boolean;
  note?: string;
  recipients?: string[];
  html?: string;
  subject?: string;
}

export function parsePayload(raw: string | undefined): EventPayload | null {
  try {
    return raw ? (JSON.parse(raw) as EventPayload) : null;
  } catch {
    return null;
  }
}

/** The line under a log event: who an email went to and whether it failed, or the decline note. */
export function emailEventMeta(payload: EventPayload | null): string {
  if (!payload) return '';
  if (typeof payload.html === 'string' && payload.html.length > 0) return 'to ' + (payload.to || []).join(', ') + (payload.sent ? '' : ' (send failed)');
  if (payload.note) return 'note: ' + payload.note;
  if (payload.recipients) return 'to ' + payload.recipients.join(', ');
  return '';
}

export const splitList = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);
