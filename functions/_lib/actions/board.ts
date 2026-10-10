// The Work Center's lists, as pure functions over rows the repo has already read: shaping open actions (which are thank-you
// tasks, which gift each is about, whether a thank-you was already logged), filtering, sorting, the Stale lanes, the Thank-yous
// lanes, and laying the hub's own pending changes over a mirror that is up to 12 hours old. No I/O.
import type { Params } from './params.ts';
import { DEFAULTS } from './params.ts';
import type { ActionRecord, Gift } from './types.ts';
import { actionFromSlim, assignmentFromSlim, giftFromSlim, parseJson, type SlimActionRow, type SlimAssignmentRow, type SlimGiftRow } from './rows.ts';
import { adoptTask, matchSatisfier } from './satisfier.ts';
import { buildObligations, type Obligation } from './obligations.ts';
import { FOLLOW_UP_TYPE } from './contact-types.ts';
import { daysBetween, ymd } from './dates.ts';

export interface Person {
  n: string;
  team: string;
  active: number; // 1 when the person is on the roster today
  left: string | null; // the end date when they left
  listed: number; // 1 when Blackbaud lists them as a fundraiser (or the staff list names their id)
}

export type People = Record<string, Person>;

export const isLive = (people: People, id: string): boolean => {
  const p = people[id];
  return !!(p && p.active && p.listed);
};

/** How a name reads when that person can no longer own work: left Favor, or never set up as a fundraiser. */
export function goneNote(people: People, id: string): '' | ' (left)' | ' (inactive)' {
  if (isLive(people, id)) return '';
  const p = people[id];
  return p && (p.listed || p.left) ? ' (left)' : ' (inactive)';
}

export const TEAM_LABEL: Record<string, string> = {
  'Regional Development Director (RDD)': 'RDD',
  'Partner Care': 'Partner Care',
  Support: 'Support',
  'Church Engagement Director': 'Church Engagement',
  'Foundation Steward': 'Grants',
  Operations: 'Operations',
  'Executive Director': 'Executive',
  'U.S. Executive Director': 'Executive',
  Marketing: 'Marketing',
  'Tech & Systems': 'Technology',
};

export const TYPE_LABEL: Record<string, string> = {
  'RESERVED (Follow Up - New Gift Received)': 'Follow Up - New Gift',
  'RESERVED (Grant Request)': 'Grant Request',
  'RESERVED (Grant Report)': 'Grant Report',
  'RESERVED (Review New Constituent Record)': 'Review New Record',
  'Stewardship--5 RDD': 'Stewardship (old type)',
  'Solicitation--4 RDD': 'Solicitation (old type)',
  'Cultivation--3 RDD': 'Cultivation (old type)',
};

export const HOLD_ORDER = ['RDD', 'Church Engagement', 'Grants', 'Partner Care'];

const TY_WORDS = /thank|\bty\b|new .{0,12}gift|gift rec|gift received|consistent gift|new rec\b|paypal gift|stripe/i;

/** One open action as the open-actions query returns it. */
export interface OpenRow extends SlimActionRow {
  /** The action's whole date_modified as the mirror holds it, with its offset. */
  modfull?: string | null;
  priority?: string | null;
  lookup: string | null;
  partner: string | null;
  city: string | null;
  st: string | null;
  deceased: number | string | boolean | null;
}

export interface BoardInput {
  today: string;
  open: OpenRow[];
  later: SlimActionRow[]; // completed actions on the same partners, since the gift window opens
  gifts: SlimGiftRow[];
  assigns: SlimAssignmentRow[];
  funds: Record<string, string>;
  people: People;
  params?: Params;
}

export interface Later {
  id: string;
  date: string;
  summary: string;
  category: string | null;
  by: string[];
  strength: 'thanked' | 'contact';
}

export interface PendingMark {
  op: string; // complete | thank | close_thanked | reassign | reschedule | create
  state: 'saving' | 'queued' | 'sent';
  label: string;
}

export interface BoardRow {
  id: string;
  due: string;
  added: string;
  type: string;
  typeRaw: string;
  category: string;
  summary: string;
  description: string;
  /** The whole description as the mirror holds it (up to 2,000 characters). Stays on the server; never sent to the page. */
  fullDescription?: string;
  /** When Blackbaud last changed this action, as the mirror holds it. Server only: the write guard compares it with Blackbaud's own. */
  mod?: string;
  cid: string;
  lookup: string;
  partner: string;
  place: string;
  fundraisers: string[];
  holders: string[];
  gift: { id: string; amount: number; date: string; fund: string } | null;
  later: Later | null;
  group: string[] | null;
  deceased: boolean;
  ty: boolean;
  ctg: boolean;
  priority: string;
  pending: PendingMark | null;
  reopened?: boolean;
}

export function holdersOf(cid: string, assigns: SlimAssignmentRow[], people: People): string[] {
  const out: string[] = [];
  for (const a of assigns) {
    if (a.cid === cid && isLive(people, a.fid) && !out.includes(a.fid)) out.push(a.fid);
  }
  const rank = (f: string) => {
    const i = HOLD_ORDER.indexOf(people[f]?.team || '');
    return i === -1 ? 9 : i;
  };
  return out.sort((a, b) => rank(a) - rank(b));
}

const isCtg = (type: string | null, summary: string) => !!type && type.includes('Follow Up') && /^(ctg )?recurring gift$/i.test(summary.trim());

/** Turn raw mirror rows into the list the screens show. */
export function shapeBoard(inp: BoardInput): BoardRow[] {
  const p = inp.params || DEFAULTS;
  const gifts: Gift[] = inp.gifts.map(giftFromSlim);
  const obligations: Obligation[] = buildObligations(gifts, p);
  const giftById = new Map(gifts.map((g) => [g.id, g]));
  const giftRowById = new Map(inp.gifts.map((g) => [String(g.id), g]));
  const laterByCid = new Map<string, ActionRecord[]>();
  for (const r of inp.later) {
    const a = actionFromSlim(r);
    if (!laterByCid.has(a.constituentId)) laterByCid.set(a.constituentId, []);
    laterByCid.get(a.constituentId)!.push(a);
  }
  const fundOf = (giftId: string): string => {
    const raw = giftRowById.get(giftId);
    const sp = parseJson<any[]>(raw?.splits, []);
    if (!sp.length) return '';
    return (inp.funds[String(sp[0]?.fund_id)] || '') + (sp.length > 1 ? ' and more' : '');
  };

  const rows: BoardRow[] = inp.open.map((o) => {
    const a = actionFromSlim(o);
    const summ = (o.summary || '').trim();
    const text = `${o.summary || ''} ${o.description || ''}`;
    const ctg = isCtg(o.type, summ);
    const ty = (o.type === FOLLOW_UP_TYPE && !ctg) || (['RDD Action', 'PC Action', 'CED Action'].includes(o.type || '') && TY_WORDS.test(text));
    let gift: BoardRow['gift'] = null;
    let linked: Obligation | null = null;
    if (ty || ctg) {
      const r = adoptTask(a, obligations, p);
      if (r.obligationKey && r.giftId) {
        linked = obligations.find((x) => x.key === r.obligationKey) || null;
        const g = giftById.get(r.giftId);
        if (g) gift = { id: g.id, amount: g.amount, date: g.giftDate, fund: fundOf(g.id) };
      }
    }
    let later: Later | null = null;
    if (ty) {
      const res = matchSatisfier(
        { partnerIds: [a.constituentId], anchorDate: a.dateAdded, excludeIds: [a.id], giftAmounts: linked ? linked.gifts.map((g) => g.amount) : gift ? [gift.amount] : [] },
        laterByCid.get(a.constituentId) || [],
        p
      );
      if (res.action) {
        const x = res.action;
        later = {
          id: x.id,
          date: x.completedDate || x.dueDate || x.dateAdded,
          summary: x.summary.trim().slice(0, 90),
          category: x.category,
          by: x.fundraisers,
          strength: res.level === 'strict' ? 'thanked' : 'contact',
        };
      }
    }
    const city = [o.city, o.st].filter(Boolean).join(', ');
    return {
      id: String(o.id),
      due: ymd(o.due),
      added: ymd(o.added),
      type: TYPE_LABEL[o.type || ''] || o.type || 'No type',
      typeRaw: o.type || '',
      category: o.category || 'Task/Other',
      summary: summ.slice(0, 255),
      description: String(o.description || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      fullDescription: String(o.description || ''),
      mod: String(o.modfull || ''),
      cid: String(o.cid),
      lookup: o.lookup || '',
      partner: o.partner || '(no name)',
      place: city,
      fundraisers: a.fundraisers,
      holders: holdersOf(String(o.cid), inp.assigns, inp.people),
      gift,
      later,
      group: null,
      deceased: o.deceased === 1 || o.deceased === '1' || o.deceased === true,
      ty,
      ctg,
      priority: o.priority || '',
      pending: null,
    };
  });

  // One letter per gift: open thank-you tasks on the same partner about the same gift show as one row.
  const grp = new Map<string, string[]>();
  for (const r of rows) if (r.ty && r.gift) grp.set(`${r.cid}|${r.gift.id}`, (grp.get(`${r.cid}|${r.gift.id}`) || []).concat(r.id));
  for (const r of rows) if (r.ty && r.gift) {
    const ids = grp.get(`${r.cid}|${r.gift.id}`)!;
    r.group = ids.length > 1 ? ids : null;
  }
  return rows;
}

/* ------------------------------------------------------------------ the hub's own pending changes over the mirror */

export interface PendingChange {
  actionId: string;
  op: string; // complete | thank | close_thanked | reassign | reschedule
  state: 'queued' | 'sent' | 'verified';
  at: string; // ISO time the change was made
  tonight: boolean;
  body: Record<string, unknown>; // the PATCH body, for reschedule and reassign
}

/**
 * Lay the hub's changes over mirror rows. A change applies only while it is newer than the mirror's last sync. When the
 * mirror is newer and still shows a completed task open, someone reopened it in Blackbaud: the row stays, flagged, and the hub
 * never closes it again by itself (action 35805 was reopened that way on 2026-10-09).
 */
const SYNC_GRACE_MS = 30 * 60000;
function graceBefore(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t - SYNC_GRACE_MS).toISOString();
}

export function applyOverlay(rows: BoardRow[], changes: PendingChange[], syncedAt: string): BoardRow[] {
  const by = new Map<string, PendingChange[]>();
  for (const c of changes) by.set(c.actionId, (by.get(c.actionId) || []).concat(c));
  const out: BoardRow[] = [];
  for (const r of rows) {
    const list = (by.get(r.id) || []).sort((a, b) => (a.at < b.at ? -1 : 1));
    let row = r;
    let hidden = false;
    for (const c of list) {
      // A sync that began before the change can finish after it, so a change made within half an hour before the sync's finish still counts as newer.
      const newer = !syncedAt || c.at > graceBefore(syncedAt);
      if (c.op === 'complete' || c.op === 'thank' || c.op === 'close_thanked') {
        if (newer) {
          if (c.state === 'queued') {
            row = { ...row, pending: c.tonight ? { op: c.op, state: 'queued', label: 'Marked complete · goes to Blackbaud tonight' } : { op: c.op, state: 'saving', label: 'Saving' } };
          } else hidden = true;
        } else if (c.state !== 'queued') row = { ...row, reopened: true };
      } else if (c.op === 'reschedule' && newer && typeof c.body.date === 'string') {
        row = { ...row, due: c.body.date.slice(0, 10) };
      } else if (c.op === 'reassign' && newer && Array.isArray(c.body.fundraisers)) {
        row = { ...row, fundraisers: (c.body.fundraisers as unknown[]).map(String) };
      }
    }
    if (!hidden) out.push(row);
  }
  return out;
}

/* ------------------------------------------------------------------ filters, facets, sort */

export interface Filters {
  fr?: string;
  theirs?: boolean;
  type?: string;
  cat?: string;
  due?: string;
  q?: string;
  cid?: string;
  quick?: string;
}

export const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const dayDiff = (iso: string, today: string): number => daysBetween(today, iso);

export function matches(a: BoardRow, f: Filters, today: string, people: People, skip?: string): boolean {
  if (f.fr && skip !== 'fr') {
    if (f.fr === '_none') {
      if (a.fundraisers.length) return false;
    } else if (!a.fundraisers.includes(f.fr) && !(f.theirs && a.holders.includes(f.fr))) return false;
  }
  if (f.type && skip !== 'type' && a.type !== f.type) return false;
  if (f.cat && skip !== 'cat' && a.category !== f.cat) return false;
  if (f.cid && a.cid !== f.cid) return false;
  if (f.due && skip !== 'due') {
    const n = dayDiff(a.due, today);
    if (f.due === 'past' && !(n < 0)) return false;
    if (f.due === 'today' && n !== 0) return false;
    if (f.due === 'week' && !(n >= 0 && n <= 7)) return false;
    if (f.due === 'l30' && !(n < -30)) return false;
    if (f.due === 'l90' && !(n < -90)) return false;
    if (f.due === 'l365' && !(n <= -365)) return false;
  }
  if (f.quick === 'ty' && !a.ty) return false;
  if (f.quick === 'done' && !(a.ty && a.later)) return false;
  if (f.quick === 'ctg' && !a.ctg) return false;
  if (f.quick === 'past' && !(dayDiff(a.due, today) < 0)) return false;
  if (f.q) {
    const hay = norm(`${a.partner} ${a.summary} ${a.description} ${a.id} ${a.lookup} ${a.fundraisers.map((x) => people[x]?.n || '').join(' ')}`);
    if (!norm(f.q).split(' ').every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function sortRows(rows: BoardRow[], by: string, dir: 1 | -1, people: People): BoardRow[] {
  const k = (a: BoardRow) => (by === 'partner' ? a.partner.toLowerCase() : by === 'added' ? a.added : by === 'fr' ? a.fundraisers.map((x) => people[x]?.n || '').join() || '~' : a.due);
  return rows.slice().sort((x, y) => (k(x) < k(y) ? -1 : k(x) > k(y) ? 1 : Number(x.id) - Number(y.id)) * dir);
}

export interface Facets {
  fr: { id: string; name: string; n: number; live: boolean }[];
  noOwner: number;
  type: { v: string; n: number }[];
  cat: { v: string; n: number }[];
}

/** Option counts for each filter, respecting the other filters. */
export function facetsOf(rows: BoardRow[], f: Filters, today: string, people: People): Facets {
  const frCount = new Map<string, number>();
  let noOwner = 0;
  for (const a of rows.filter((x) => matches(x, f, today, people, 'fr'))) {
    if (!a.fundraisers.length) noOwner++;
    for (const id of a.fundraisers) frCount.set(id, (frCount.get(id) || 0) + 1);
  }
  const typeCount = new Map<string, number>();
  for (const a of rows.filter((x) => matches(x, f, today, people, 'type'))) typeCount.set(a.type, (typeCount.get(a.type) || 0) + 1);
  const catCount = new Map<string, number>();
  for (const a of rows.filter((x) => matches(x, f, today, people, 'cat'))) catCount.set(a.category, (catCount.get(a.category) || 0) + 1);
  return {
    fr: [...frCount.entries()]
      .map(([id, n]) => ({ id, name: people[id]?.n || `Fundraiser ${id}`, n, live: isLive(people, id) }))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name)),
    noOwner,
    type: [...typeCount.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n),
    cat: [...catCount.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => a.v.localeCompare(b.v)),
  };
}

export interface Counts {
  open: number;
  past: number;
  ty: number;
  done: number;
  ctg: number;
}

export function countsOf(rows: BoardRow[], today: string): Counts {
  return {
    open: rows.length,
    past: rows.filter((a) => dayDiff(a.due, today) < 0).length,
    ty: rows.filter((a) => a.ty).length,
    done: rows.filter((a) => a.ty && a.later).length,
    ctg: rows.filter((a) => a.ctg).length,
  };
}

/* ------------------------------------------------------------------ Stale lanes */

export interface Lane {
  k: string;
  n: string;
  hint: string;
  test: (a: BoardRow, today: string, people: People) => boolean;
}

const departed = (a: BoardRow, people: People) => a.fundraisers.some((x) => !isLive(people, x));

export const LANES: Lane[] = [
  { k: 'left', n: 'Owner left or inactive', hint: "Someone on it left Favor or is not set up as a fundraiser. Give it to the partner's current holder.", test: (a, _t, p) => departed(a, p) },
  { k: 'none', n: 'No owner', hint: 'Blackbaud shows these to nobody.', test: (a) => a.fundraisers.length === 0 },
  { k: 'year', n: 'A year late or more', hint: 'More than a year past due.', test: (a, t) => dayDiff(a.due, t) <= -365 },
  { k: '90', n: '90 days to a year', hint: 'Close as no longer needed, or reschedule.', test: (a, t) => dayDiff(a.due, t) < -90 && dayDiff(a.due, t) > -365 },
  { k: '30', n: '30 to 90 days late', hint: 'Still counted. Check before closing.', test: (a, t) => dayDiff(a.due, t) < -30 && dayDiff(a.due, t) >= -90 },
  { k: 'ctg', n: 'Recurring Gift tasks', hint: 'Made by a Blackbaud workflow for every new recurring gift.', test: (a) => a.ctg },
];

/** A task about a gift of $1,000 or more is never swept up by Select all in a stale lane; it is picked by hand (spec 5.5 S3). */
export const bigGift = (a: BoardRow, params: Params = DEFAULTS): boolean => !!a.gift && a.gift.amount >= params.NEVER_AUTOCLOSE_GIFT_AMOUNT;

/* ------------------------------------------------------------------ Thank-yous */

export interface ThankGroup {
  key: string;
  ids: string[];
  row: BoardRow;
  later: Later | null;
}

export function thankGroups(rows: BoardRow[], owner: string): ThankGroup[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: ThankGroup[] = [];
  for (const a of rows) {
    if (!a.ty || seen.has(a.id) || (owner && !a.fundraisers.includes(owner))) continue;
    const ids = (a.group || [a.id]).filter((id) => byId.has(id));
    ids.forEach((id) => seen.add(id));
    const lead = byId.get(ids[0]) || a;
    const laters = ids.map((id) => byId.get(id)!.later);
    const later = laters.find((l) => l && l.strength === 'thanked') || laters.find(Boolean) || null;
    out.push({ key: lead.id, ids, row: lead, later });
  }
  return out;
}

export function thankLanes(groups: ThankGroup[]) {
  return {
    thanked: groups.filter((g) => g.later && g.later.strength === 'thanked'),
    probably: groups.filter((g) => g.later && g.later.strength === 'contact'),
    owed: groups.filter((g) => !g.later),
  };
}

/** Owners with thank-you tasks, for the chips above the list. */
export function thankOwners(rows: BoardRow[], people: People): { id: string; name: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const a of rows) if (a.ty) for (const f of a.fundraisers) counts.set(f, (counts.get(f) || 0) + 1);
  return [...counts.entries()]
    .filter(([id]) => isLive(people, id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => ({ id, name: people[id]?.n || id, n: thankGroups(rows, id).length }));
}
