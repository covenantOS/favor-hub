// Mirror row shapes into the plain engine types. The hub reads the mirror over HTTP, where a raw_json column can run to
// 28 KB a row, so the Work Center selects the few fields it needs with json_extract and this file reads those columns.
// Pure; no I/O.
import type { ActionRecord, Assignment, Fundraiser, Gift } from './types.ts';
import { ymd } from './dates.ts';

/** One action as the Work Center's SQL returns it (columns named in functions/_lib/work/repo.ts). */
export interface SlimActionRow {
  id: string;
  cid: string;
  due: string | null;
  added: string | null;
  modified: string | null;
  type: string | null;
  category: string | null;
  summary: string | null;
  description: string | null;
  completed: number | string | boolean | null;
  completed_date: string | null;
  status: string | null;
  computed: string | null;
  frs: string | null; // JSON array of fundraiser ids
}

export function parseJson<T = any>(s: unknown, fallback: T): T {
  if (s === null || s === undefined || s === '') return fallback;
  if (typeof s !== 'string') return s as T;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export const isTrue = (v: unknown): boolean => v === 1 || v === true || v === '1' || v === 'true';

export function actionFromSlim(r: SlimActionRow): ActionRecord {
  const completedDate = r.completed_date ? ymd(r.completed_date) : null;
  // The flag decides. A row with no flag at all falls back to the date (spec 0.1).
  const completed = r.completed === null || r.completed === undefined ? completedDate !== null : isTrue(r.completed);
  const fr = parseJson<unknown[]>(r.frs, []);
  return {
    id: String(r.id),
    constituentId: String(r.cid),
    category: r.category ?? null,
    type: r.type ?? null,
    completed,
    completedDate,
    rawStatus: r.status ?? null,
    computedStatus: r.computed ?? null,
    dueDate: ymd(r.due),
    dateAdded: ymd(r.added),
    dateModified: ymd(r.modified),
    summary: r.summary ?? '',
    description: r.description ?? '',
    fundraisers: Array.isArray(fr) ? fr.map(String) : [],
  };
}

export interface SlimGiftRow {
  id: string;
  cid: string;
  amount: number | string | null;
  gift_date: string | null;
  added: string | null;
  gift_type: string | null;
  gift_status: string | null;
  soft: string | null;
  credits: string | null;
  splits?: string | null;
}

export function giftFromSlim(r: SlimGiftRow): Gift {
  const soft = parseJson<any[]>(r.soft, []);
  const fr = parseJson<any[]>(r.credits, []);
  const credits = (Array.isArray(fr) ? fr : []).map((c: any) => ({ id: String(c.constituent_id), amount: Number(c.amount?.value ?? 0) }));
  credits.sort((a, b) => b.amount - a.amount || Number(a.id) - Number(b.id));
  return {
    id: String(r.id),
    giverId: String(r.cid),
    softCreditIds: (Array.isArray(soft) ? soft : []).map((c: any) => String(c.constituent_id)).filter(Boolean),
    fundraiserIds: credits.map((c) => c.id),
    amount: Number(r.amount ?? 0),
    giftDate: ymd(r.gift_date),
    enteredDate: ymd(r.added),
    type: r.gift_type ?? '',
    status: r.gift_status ?? '',
  };
}

export interface SlimFundraiserRow {
  id: string;
  first: string | null;
  last: string | null;
  type: string | null;
  end: string | null;
  active: number | null;
}

export function fundraiserFromSlim(r: SlimFundraiserRow): Fundraiser {
  return {
    id: String(r.id),
    name: `${r.first ?? ''} ${r.last ?? ''}`.trim(),
    type: r.type ?? '',
    active: Number(r.active) === 1,
    endDate: r.end ? ymd(r.end) : null,
  };
}

export interface SlimAssignmentRow {
  id?: string;
  cid: string;
  fid: string;
  type: string | null;
  from: string | null;
  to: string | null;
}

export function assignmentFromSlim(r: SlimAssignmentRow): Assignment {
  return {
    id: String(r.id ?? `${r.cid}:${r.fid}`),
    partnerId: String(r.cid),
    fundraiserId: String(r.fid),
    type: r.type ?? '',
    fromDate: r.from ? ymd(r.from) : null,
    toDate: r.to ? ymd(r.to) : null,
  };
}
