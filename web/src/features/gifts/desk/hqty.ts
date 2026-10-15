// Gifts > Thank-you letters: the read, the types and the rules that decide what a row shows. Pure and light, so the route file can import it.
// Ported from public/js/work-hqty.js; the server is functions/_lib/work/hqty.ts (the D1 copy of Blackbaud, no Blackbaud calls on a read).
import { queryOptions } from '@tanstack/react-query';
import { workGet } from '../../partners/work/lists/core';

export type HqtyState = 'write' | 'printed' | 'signed' | 'mailed' | 'cannot';
export interface HqtyRow {
  key: string;
  giftId: string;
  cid: string;
  amount: number;
  date: string;
  month: string;
  type: string;
  pay: string;
  fund: string;
  partner: { name: string; place: string };
  through: string | null;
  address: string;
  flags: string[];
  state: HqtyState;
  source: 'hub' | 'blackbaud' | '';
  stateDate: string;
  actionId: string;
  why: string;
  signer: string;
  signerName: string;
  signerTitle: string;
  rdd: string;
  picked: boolean;
}
export interface HqtyStats {
  write: number;
  printed: number;
  signed: number;
  mailedMonth: number;
  earlier: number;
  total: number;
}
export interface HqtyData {
  ok: true;
  today: string;
  synced: string;
  since: string;
  rows: HqtyRow[];
  stats: HqtyStats;
  whys: string[];
  text: { month: string; body: string; saved: boolean; defaultBody: string };
  months: Record<string, string>;
  signers: { key: string; label: string }[];
}
export interface LetterDoc {
  giftId?: string;
  dateLine: string;
  addressLines: string[];
  greeting: string;
  paragraphs: string[];
  closing: string;
  signerName: string;
  signerTitle: string;
}

export const hqtyQuery = (as = '') =>
  queryOptions({
    queryKey: ['gifts', 'hqty', as],
    queryFn: () => workGet<HqtyData>('/api/work/hqty', as),
    // The desk keeps its own edits (printed, signed) in the cache while it is open, so a focus change does not read it again.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

export const PAGE = 60;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const STATE: Record<HqtyState, [string, string]> = {
  write: ['To write', 'wc-tag--gift'],
  printed: ['Printed', 'wc-tag--maybe'],
  signed: ['Signed', 'wc-tag--queued'],
  mailed: ['Mailed', 'wc-tag--done'],
  cannot: ['Cannot send', ''],
};

/** The first day of last month: gifts before it that still have no letter are "Earlier gifts". */
export const recentFrom = (today: string): string => {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7)) - 1;
  if (m === 0) {
    m = 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, '0')}-01`;
};
export const blocked = (r: HqtyRow): boolean => r.flags.includes('No mailing address') || r.flags.includes('No partner credited');
export const inFilter = (r: HqtyRow, k: string, today: string): boolean => {
  if (!k) return true;
  if (k === 'write') return r.state === 'write' && r.date >= recentFrom(today);
  if (k === 'earlier') return r.state === 'write' && r.date < recentFrom(today);
  if (k === 'mailed') return r.state === 'mailed' && r.stateDate >= today.slice(0, 7) + '-01';
  return r.state === k;
};
export const visibleRows = (d: HqtyData, filter: string, q: string): HqtyRow[] => {
  const needle = q.toLowerCase();
  return d.rows.filter((r) => inFilter(r, filter, d.today) && (!q || (r.partner.name + ' ' + r.fund + ' ' + r.address + ' ' + (r.through || '')).toLowerCase().includes(needle)));
};
export const monthLabel = (ym: string, today: string): string => MONTHS[Number(ym.slice(5, 7)) - 1] + (ym.slice(0, 4) !== today.slice(0, 4) ? ' ' + ym.slice(0, 4) : '');

/** Count the stats again from the rows, as the desk does after a step that the page shows before the next read. */
export function recount(d: HqtyData): void {
  const rf = recentFrom(d.today);
  const ms = d.today.slice(0, 7) + '-01';
  d.stats = { write: 0, printed: 0, signed: 0, mailedMonth: 0, earlier: 0, total: d.rows.length };
  for (const r of d.rows) {
    if (r.state === 'write') d.stats[r.date >= rf ? 'write' : 'earlier']++;
    else if (r.state === 'printed') d.stats.printed++;
    else if (r.state === 'signed') d.stats.signed++;
    else if (r.state === 'mailed' && r.stateDate >= ms) d.stats.mailedMonth++;
  }
}

/** A copy of the desk to edit; rows are copied so React sees the change. */
export const cloneDesk = (d: HqtyData): HqtyData => ({ ...d, rows: d.rows.map((r) => ({ ...r })), stats: { ...d.stats } });

/** The step a row's own button takes. */
export function applyStep(d: HqtyData, ids: string[], to: string, why: string, done?: string[]): void {
  const set = new Set(done || ids);
  for (const r of d.rows) {
    if (!set.has(r.giftId)) continue;
    if (to === 'printed' && r.state === 'write') {
      r.state = 'printed';
      r.source = 'hub';
      r.stateDate = d.today;
    } else if (to === 'signed') {
      r.state = 'signed';
      r.source = 'hub';
      r.stateDate = d.today;
    } else if (to === 'cannot') {
      r.state = 'cannot';
      r.source = 'hub';
      r.why = why;
    } else if (to === 'reset') {
      r.state = 'write';
      r.source = '';
      r.why = '';
      r.stateDate = '';
    }
  }
  recount(d);
}
