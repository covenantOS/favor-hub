// Every field a fundraiser or Support can change on an action, how each is checked, and the smart defaults the edit panel and the
// new-action form start from. Pure: no database, no Blackbaud. The upkeep route on favorintl.org allows exactly these keys
// (Blackbaud's ActionEdit and ActionAdd), so a field added here and not there is refused at the route.

export const CATEGORIES = ['Phone call', 'Meeting', 'Mailing', 'Email', 'Task/Other'] as const;
export const PRIORITIES = ['Normal', 'High', 'Low'] as const;
export const DIRECTIONS = ['Inbound', 'Outbound'] as const;
export const OUTCOMES = ['Successful', 'Unsuccessful'] as const;

/** The code tables an edit is checked against. They come from Blackbaud (cached a week) with the mirror's values as the fallback. */
export interface Codes {
  types: string[];
  statuses: string[];
  locations: string[];
  noteTypes: string[];
  tagCategories: { name: string; type: string; codeTable?: string; values?: string[] }[];
  oppStatuses: string[];
  oppPurposes: string[];
}

export const FALLBACK_CODES: Codes = {
  types: ['RDD Action', 'PC Action', 'CED Action', 'Carole Action', 'Terry Action', 'Grants Action', 'RESERVED (Follow Up - New Gift Received)', 'RESERVED (Information Update)', 'RESERVED (HQTY Letter)'],
  statuses: ['Open', 'Completed', 'Canceled'],
  locations: ['Residence', 'Business', 'Event', 'On Campus', 'Off Campus', 'Other'],
  noteTypes: ['RDD Note', 'Partner Care Note', 'Added via Web View'],
  tagCategories: [
    { name: 'Thanked', type: 'CodeTableEntry' },
    { name: 'Texted', type: 'CodeTableEntry' },
    { name: 'Stewardship', type: 'CodeTableEntry' },
    { name: 'Scheduling', type: 'CodeTableEntry' },
    { name: 'Amount of Ask', type: 'Number' },
    { name: 'Number of Referrals', type: 'Number' },
  ],
  oppStatuses: ['Researching', 'Planned', 'Application in Progress', 'Application Submitted', 'LOI in Progress', 'LOI Submitted', 'Awarded - Active', 'Awarded - Closed', 'Declined', 'Abandoned'],
  oppPurposes: ['Annual Giving', 'Leadership Giving', 'Planned Gift', 'Engagement', 'Grant Request'],
};

/** The action fields the panel edits, in the order the panel shows them. */
export const EDIT_KEYS = [
  'summary', 'category', 'type', 'status', 'date', 'start_time', 'end_time', 'completed', 'completed_date', 'priority', 'direction',
  'location', 'outcome', 'fundraisers', 'opportunity_id', 'description',
] as const;
export type EditKey = (typeof EDIT_KEYS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^\d{1,12}$/;

export const stamp = (ymd: string): string => `${ymd}T00:00:00`;

export function addDaysIso(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export interface Checked {
  body: Record<string, unknown>;
  errors: string[];
}

const pick = (list: readonly string[], v: unknown): string | null => {
  const s = String(v ?? '').trim();
  const hit = list.find((x) => x.toLowerCase() === s.toLowerCase());
  return hit ?? null;
};

/**
 * Check the fields a person set and turn them into the body Blackbaud takes. Unknown keys are dropped. An empty value on a field
 * that may be empty clears it (null). Dates go as midnight local stamps, the way Blackbaud stores them.
 */
export function checkFields(set: Record<string, unknown>, codes: Codes, today: string, opts: { create?: boolean } = {}): Checked {
  const body: Record<string, unknown> = {};
  const errors: string[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k);
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
  if (has('summary')) {
    const s = String(set.summary ?? '').replace(/\s+/g, ' ').trim();
    if (s.length > 255) errors.push('The summary can be 255 characters at most.');
    else body.summary = s;
  }
  if (has('description')) {
    const d = String(set.description ?? '').replace(/\r\n/g, '\n');
    if (d.length > 20000) errors.push('The description is too long.');
    else body.description = d;
  }
  if (has('category')) {
    const c = pick(CATEGORIES, set.category);
    if (!c) errors.push('Pick a category from the list.');
    else body.category = c;
  }
  if (has('type')) {
    if (blank(set.type)) body.type = null;
    else {
      const t = pick(codes.types, set.type);
      if (!t) errors.push('Pick a type from the list.');
      else body.type = t;
    }
  }
  if (has('status')) {
    const s = pick(codes.statuses, set.status);
    if (!s) errors.push('Pick a status from the list.');
    else body.status = s;
  }
  if (has('date')) {
    const v = String(set.date ?? '').slice(0, 10);
    if (!DATE.test(v) || v < '2000-01-01' || v > addDaysIso(today, 3650)) errors.push('Pick a real date.');
    else body.date = stamp(v);
  }
  for (const k of ['start_time', 'end_time'] as const) {
    if (!has(k)) continue;
    if (blank(set[k])) body[k] = null;
    else if (!TIME.test(String(set[k]))) errors.push('Times look like 09:30 or 14:00.');
    else body[k] = String(set[k]);
  }
  if (has('start_time') && has('end_time') && body.start_time && body.end_time && String(body.end_time) < String(body.start_time)) errors.push('The end time comes before the start time.');
  if (has('completed')) body.completed = set.completed === true || set.completed === 'true' || set.completed === 1;
  if (has('completed_date')) {
    if (blank(set.completed_date)) body.completed_date = null;
    else {
      const v = String(set.completed_date).slice(0, 10);
      if (!DATE.test(v) || v > addDaysIso(today, 1)) errors.push('A completion date cannot be in the future.');
      else body.completed_date = stamp(v);
    }
  }
  if (body.completed === true && !body.completed_date && !has('completed_date')) body.completed_date = stamp(today);
  if (has('priority')) {
    const p = pick(PRIORITIES, set.priority);
    if (!p) errors.push('Priority is Normal, High or Low.');
    else body.priority = p;
  }
  if (has('direction')) {
    if (blank(set.direction)) body.direction = null;
    else {
      const d = pick(DIRECTIONS, set.direction);
      if (!d) errors.push('Direction is Inbound or Outbound.');
      else body.direction = d;
    }
  }
  if (has('location')) {
    if (blank(set.location)) body.location = null;
    else {
      const l = pick(codes.locations, set.location);
      if (!l) errors.push('Pick a location from the list.');
      else body.location = l;
    }
  }
  if (has('outcome')) {
    if (blank(set.outcome)) body.outcome = null;
    else {
      const o = pick(OUTCOMES, set.outcome);
      if (!o) errors.push('Outcome is Successful or Unsuccessful.');
      else body.outcome = o;
    }
  }
  if (has('fundraisers')) {
    const list = Array.isArray(set.fundraisers) ? set.fundraisers.map(String) : [];
    if (list.some((x) => !ID.test(x))) errors.push('A fundraiser on the list is not a Blackbaud record.');
    else body.fundraisers = [...new Set(list)];
  }
  if (has('opportunity_id')) {
    if (blank(set.opportunity_id)) body.opportunity_id = null;
    else if (!ID.test(String(set.opportunity_id))) errors.push('Pick an opportunity from the list.');
    else body.opportunity_id = String(set.opportunity_id);
  }
  // A status and the completed flag describe the same thing; keep them in step so Blackbaud never gets a contradiction.
  if (body.status === 'Completed' && body.completed === undefined) {
    body.completed = true;
    if (!body.completed_date && !has('completed_date')) body.completed_date = stamp(today);
  }
  if (body.status === 'Open' && body.completed === undefined) body.completed = false;
  if (body.completed === false && body.status === undefined && !opts.create) body.status = 'Open';
  if (opts.create) {
    if (!body.category) errors.push('Pick a category.');
    if (!body.date) body.date = stamp(today);
    if (body.priority === undefined) body.priority = 'Normal';
  }
  return { body, errors };
}

/** The value a raw Blackbaud action holds for each key, in the shape a PATCH puts back. Used for Undo and for the conflict check. */
export function valuesOf(raw: Record<string, any>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = raw[k];
    if (k === 'fundraisers') out[k] = Array.isArray(v) ? v.map(String) : [];
    else if (k === 'completed') out[k] = Boolean(v);
    else if (k === 'date') out[k] = v ? stamp(String(v).slice(0, 10)) : undefined;
    else if (k === 'completed_date') out[k] = v ? stamp(String(v).slice(0, 10)) : null;
    else out[k] = v === undefined || v === '' ? null : v;
  }
  return out;
}

/** Whether two values of one field mean the same thing (dates compared by day, fundraiser lists in any order). */
export function sameValue(k: string, a: unknown, b: unknown): boolean {
  if (k === 'fundraisers') return JSON.stringify([...((a as string[]) || [])].map(String).sort()) === JSON.stringify([...((b as string[]) || [])].map(String).sort());
  if (k === 'date' || k === 'completed_date') return String(a ?? '').slice(0, 10) === String(b ?? '').slice(0, 10);
  if (k === 'completed') return Boolean(a) === Boolean(b);
  const n = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
  return n(a) === n(b);
}

/**
 * Fields someone else changed in Blackbaud since the person opened the action: Blackbaud's value differs from what the person saw,
 * and from what they are about to write. Those would be overwritten without anyone noticing, so the edit stops and shows both.
 */
export function conflicts(current: Record<string, any>, seen: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(next)) {
    if (!Object.prototype.hasOwnProperty.call(seen, k)) continue;
    const now = valuesOf(current, [k])[k];
    if (!sameValue(k, now, seen[k]) && !sameValue(k, now, next[k])) out.push(k);
  }
  return out;
}

/** The days an open task of each kind is due out from today, when the person has not picked a date. */
const DUE_OUT: Record<string, number> = { 'Task/Other': 7, 'Phone call': 2, Email: 2, Mailing: 7, Meeting: 14 };

export interface Defaults {
  category: string;
  type: string;
  date: string;
  completed: boolean;
  fundraisers: string[];
  direction: string;
  priority: string;
}

/**
 * What a new action starts with. A contact being logged (completed) is dated today; a task to do later is due out by its kind. The
 * fundraiser is the partner's current holder, else the person entering it. The type follows the fundraiser's own contact type.
 */
export function defaultsFor(o: {
  today: string;
  category?: string;
  completed?: boolean;
  holders?: string[];
  me?: string | null;
  myType?: string | null;
  holderType?: string | null;
}): Defaults {
  const category = o.category && (CATEGORIES as readonly string[]).includes(o.category) ? o.category : 'Phone call';
  const completed = o.completed ?? category !== 'Task/Other';
  const fundraisers = o.holders && o.holders.length ? [o.holders[0]] : o.me ? [o.me] : [];
  const type = (o.holders && o.holders.length ? o.holderType : o.myType) || o.myType || 'RDD Action';
  const date = completed ? o.today : addDaysIso(o.today, DUE_OUT[category] ?? 7);
  const direction = category === 'Phone call' || category === 'Email' || category === 'Mailing' ? 'Outbound' : '';
  return { category, type, date, completed, fundraisers, direction, priority: 'Normal' };
}

/* ------------------------------------------------------------------ follow-ups that repeat */

export interface Recur {
  every: number;
  unit: 'day' | 'week' | 'month';
  /** Stop after this day (YYYY-MM-DD), or after this many more. */
  until?: string | null;
  left?: number | null;
}

export function checkRecur(r: unknown): Recur | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const every = Math.floor(Number(o.every));
  const unit = o.unit === 'day' || o.unit === 'week' || o.unit === 'month' ? o.unit : null;
  if (!unit || !(every >= 1 && every <= 52)) return null;
  const until = typeof o.until === 'string' && DATE.test(o.until) ? o.until : null;
  const left = o.left === null || o.left === undefined || o.left === '' ? null : Math.max(0, Math.min(120, Math.floor(Number(o.left))));
  return { every, unit, until, left: left === null || Number.isNaN(left) ? null : left };
}

/** The next due date after `from`. Months keep the day, falling back to the month's last day (Jan 31 -> Feb 28). */
export function nextDue(from: string, r: Recur): string {
  if (r.unit === 'day') return addDaysIso(from, r.every);
  if (r.unit === 'week') return addDaysIso(from, r.every * 7);
  const [y, m, d] = from.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + r.every, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Whether a repeat has one more to make after this one, and what the rule looks like after it. */
export function recurAfter(r: Recur, due: string): Recur | null {
  if (r.until && due > r.until) return null;
  if (r.left !== null && r.left !== undefined) {
    if (r.left <= 0) return null;
    return { ...r, left: r.left - 1 };
  }
  return r;
}

export function recurLabel(r: Recur): string {
  const unit = r.every === 1 ? r.unit : `${r.every} ${r.unit}s`;
  const base = r.every === 1 ? `Every ${unit}` : `Every ${unit}`;
  if (r.until) return `${base} until ${r.until}`;
  if (r.left !== null && r.left !== undefined) return `${base}, ${r.left} more`;
  return base;
}

/* ------------------------------------------------------------------ the body that copies an action (duplicate, move, follow-up) */

/** An ActionAdd body built from an action Blackbaud returned, for a copy on the same or another partner. */
export function copyBody(raw: Record<string, any>, cid: string): Record<string, unknown> {
  const out: Record<string, unknown> = { constituent_id: cid };
  for (const k of ['category', 'type', 'summary', 'description', 'priority', 'direction', 'location', 'outcome', 'start_time', 'end_time', 'status', 'opportunity_id'] as const) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') out[k] = raw[k];
  }
  out.date = raw.date ? stamp(String(raw.date).slice(0, 10)) : undefined;
  out.fundraisers = Array.isArray(raw.fundraisers) ? raw.fundraisers.map(String) : [];
  out.completed = Boolean(raw.completed);
  if (raw.completed && raw.completed_date) out.completed_date = stamp(String(raw.completed_date).slice(0, 10));
  if (!out.category) out.category = 'Task/Other';
  if (out.status === 'Completed' || out.status === 'Open' || out.status === 'Canceled') {
    // the status follows the completed flag on a create; Blackbaud refuses a contradiction
    if (out.completed && out.status !== 'Completed') out.status = 'Completed';
    if (!out.completed && out.status === 'Completed') out.status = 'Open';
  }
  return out;
}

/** The fields a person sees on an action, with plain labels, for the history of a change. */
export const LABELS: Record<string, string> = {
  summary: 'Summary', category: 'Category', type: 'Type', status: 'Status', date: 'Date', start_time: 'Start', end_time: 'End', completed: 'Completed',
  completed_date: 'Completed on', priority: 'Priority', direction: 'Direction', location: 'Location', outcome: 'Outcome', fundraisers: 'Fundraisers',
  opportunity_id: 'Opportunity', description: 'Description',
};

/* ------------------------------------------------------------------ opportunities */

export const OPP_KEYS = ['name', 'status', 'purpose', 'ask_amount', 'ask_date', 'expected_amount', 'expected_date', 'funded_amount', 'funded_date', 'deadline', 'fundraisers', 'inactive', 'summary'] as const;
const MONEY_KEYS = new Set(['ask_amount', 'expected_amount', 'funded_amount']);
const OPP_DATE_KEYS = new Set(['ask_date', 'expected_date', 'funded_date', 'deadline']);

/** Check an opportunity's fields. Amounts go as { value }, fundraisers as [{ constituent_id }], dates as midnight stamps. */
export function checkOpp(set: Record<string, unknown>, codes: Codes, opts: { create?: boolean } = {}): Checked {
  const body: Record<string, unknown> = {};
  const errors: string[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k);
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
  if (has('name')) {
    const n = String(set.name ?? '').replace(/\s+/g, ' ').trim();
    if (!n) errors.push('Give the opportunity a name.');
    else if (n.length > 255) errors.push('The name can be 255 characters at most.');
    else body.name = n;
  } else if (opts.create) errors.push('Give the opportunity a name.');
  if (has('status')) {
    if (blank(set.status)) body.status = null;
    else {
      const s = pick(codes.oppStatuses, set.status);
      if (!s) errors.push('Pick a status from the list.');
      else body.status = s;
    }
  }
  if (has('purpose')) {
    const p = pick(codes.oppPurposes, set.purpose);
    if (!p) errors.push('Pick a purpose from the list.');
    else body.purpose = p;
  }
  for (const k of MONEY_KEYS) {
    if (!has(k)) continue;
    if (blank(set[k])) {
      body[k] = { value: 0 };
      continue;
    }
    const n = Number(String(set[k]).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 100000000) errors.push('Amounts are dollars, 0 or more.');
    else body[k] = { value: Math.round(n * 100) / 100 };
  }
  for (const k of OPP_DATE_KEYS) {
    if (!has(k)) continue;
    if (blank(set[k])) body[k] = null;
    else {
      const v = String(set[k]).slice(0, 10);
      if (!DATE.test(v)) errors.push('Pick a real date.');
      else body[k] = stamp(v);
    }
  }
  if (has('fundraisers')) {
    const list = Array.isArray(set.fundraisers) ? set.fundraisers.map(String) : [];
    if (list.some((x) => !ID.test(x))) errors.push('A fundraiser on the list is not a Blackbaud record.');
    else body.fundraisers = [...new Set(list)].map((id) => ({ constituent_id: id }));
  }
  if (has('inactive')) body.inactive = set.inactive === true || set.inactive === 'true';
  if (has('summary')) body.summary = String(set.summary ?? '').slice(0, 4000);
  return { body, errors };
}

/** An opportunity as Blackbaud returns it, flattened for the page. */
export interface OppView {
  id: string;
  cid: string;
  name: string;
  status: string;
  purpose: string;
  ask: number;
  askDate: string;
  expected: number;
  expectedDate: string;
  funded: number;
  fundedDate: string;
  deadline: string;
  inactive: boolean;
  fundraisers: string[];
  summary: string;
  gifts: string[];
  modified: string;
  added: string;
}

export function oppView(raw: Record<string, any>): OppView {
  const money = (v: any) => Number(v && typeof v === 'object' ? v.value : v) || 0;
  const day = (v: any) => (v ? String(v).slice(0, 10) : '');
  return {
    id: String(raw.id),
    cid: String(raw.constituent_id || ''),
    name: String(raw.name || ''),
    status: String(raw.status || ''),
    purpose: String(raw.purpose || ''),
    ask: money(raw.ask_amount),
    askDate: day(raw.ask_date),
    expected: money(raw.expected_amount),
    expectedDate: day(raw.expected_date),
    funded: money(raw.funded_amount),
    fundedDate: day(raw.funded_date),
    deadline: day(raw.deadline),
    inactive: Boolean(raw.inactive),
    fundraisers: Array.isArray(raw.fundraisers) ? raw.fundraisers.map((f: any) => String(f && typeof f === 'object' ? f.constituent_id : f)).filter(Boolean) : [],
    summary: String(raw.summary || ''),
    gifts: Array.isArray(raw.linked_gifts) ? raw.linked_gifts.map(String) : [],
    modified: String(raw.date_modified || ''),
    added: String(raw.date_added || ''),
  };
}

/** The opportunity's values in the shape a PATCH puts back, for Undo. */
export function oppValuesOf(raw: Record<string, any>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = raw[k];
    if (MONEY_KEYS.has(k)) out[k] = { value: Number(v && typeof v === 'object' ? v.value : v) || 0 };
    else if (k === 'fundraisers') out[k] = Array.isArray(v) ? v.map((f: any) => ({ constituent_id: String(f && typeof f === 'object' ? f.constituent_id : f) })) : [];
    else if (k === 'inactive') out[k] = Boolean(v);
    else out[k] = v === undefined || v === '' ? null : v;
  }
  // Blackbaud will not take a null name or purpose; leave those out of an undo when they were empty.
  if (out.name === null) delete out.name;
  if (out.purpose === null) delete out.purpose;
  return out;
}
