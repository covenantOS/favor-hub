// Entry rows change as a person works: a click on "Call" or "Thanked", a typed summary, a picked record. Each change shows at once on
// the row (an overlay kept here) and goes to the hub in the background, one PATCH per row, typing waiting half a second. The hub's
// answer replaces the row in the cache. Same calls as public/js/work.js editRow and flushEdits.
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { wcPatch, wcPost } from '../api';
import { getClient, reloadEntry, toast } from '../engine';
import { plural } from '../model';
import type { EntryData, EntryOwner, EntryPartner, EntryRow } from './types';

// ------------------------------------------------------------------ the overlay
type Ov = Record<string, Partial<EntryRow>>;
const NONE: Ov = {};
let ov: Ov = NONE;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const setOv = (next: Ov) => {
  ov = next;
  subs.forEach((f) => f());
};
/** What a person changed on each row that the hub has not answered yet, by row id. */
export const useEntryOv = (): Ov => useSyncExternalStore(subscribe, () => ov, () => NONE);
export const mergeRow = (r: EntryRow, o: Ov): EntryRow => (o[r.id] ? { ...r, ...o[r.id] } : r);

// ------------------------------------------------------------------ partners seen in a search
const known: Record<string, EntryPartner> = {};
export interface PartnerHitLike {
  cid: string;
  name: string;
  place: string;
  lookup: string;
  holders: string[];
  deceased?: boolean;
}
export const rememberHits = (hits: PartnerHitLike[]) => {
  hits.forEach((h) => {
    known[h.cid] = { n: h.name, loc: h.place, lk: h.lookup, hold: h.holders, dec: h.deceased ? 1 : 0 };
  });
};
export const partnerOf = (d: EntryData, cid: string): EntryPartner | null => d.partners[cid] || known[cid] || null;

// ------------------------------------------------------------------ finding a row in the cache
const entryCaches = (qc: QueryClient) => qc.getQueriesData<EntryData>({ queryKey: ['work', 'entry'] });
export function findRow(id: string): EntryRow | null {
  for (const [, d] of entryCaches(getClient())) {
    const r = d?.rows.find((x) => x.id === id);
    if (r) return r;
  }
  return null;
}

// ------------------------------------------------------------------ saving a row's changes
interface Pending {
  server: Record<string, unknown>;
  local: Partial<EntryRow>;
}
const pending: Record<string, Pending> = {};
let timer: ReturnType<typeof setTimeout> | undefined;

/** Show a change on the row now and send it to the hub (at once, or after half a second for typed text). */
export function editRow(id: string, f: { local?: Partial<EntryRow>; server: Record<string, unknown> }, soon?: boolean) {
  if (!findRow(id)) return;
  const local = f.local || {};
  setOv({ ...ov, [id]: { ...ov[id], ...local } });
  const p = pending[id] || { server: {}, local: {} };
  pending[id] = { server: { ...p.server, ...f.server }, local: { ...p.local, ...local } };
  clearTimeout(timer);
  timer = setTimeout(() => void flushEdits(), soon ? 600 : 0);
}

/** Drop the overlay keys the hub has answered for, unless the person typed something newer meanwhile. */
function settle(id: string, sent: Partial<EntryRow>) {
  const cur = ov[id];
  if (!cur) return;
  const next = { ...cur } as Record<string, unknown>;
  for (const [k, v] of Object.entries(sent)) if (JSON.stringify(next[k]) === JSON.stringify(v)) delete next[k];
  const all = { ...ov };
  if (Object.keys(next).length) all[id] = next as Partial<EntryRow>;
  else delete all[id];
  setOv(all);
}

export async function flushEdits(): Promise<void> {
  clearTimeout(timer);
  const qc = getClient();
  for (const id of Object.keys(pending)) {
    const { server, local } = pending[id];
    delete pending[id];
    try {
      const out = await wcPatch<{ row: EntryRow; partners?: Record<string, EntryPartner> }>('/api/work/entry/' + id, server);
      qc.setQueriesData<EntryData>({ queryKey: ['work', 'entry'] }, (d) => {
        if (!d || !d.rows.some((x) => x.id === id)) return d;
        return { ...d, rows: d.rows.map((x) => (x.id === id ? out.row : x)), partners: { ...d.partners, ...(out.partners || {}) } };
      });
      settle(id, local);
      if ('constituent_id' in server || 'contact_date' in server || 'skip' in server) await reloadEntry();
    } catch (e) {
      toast((e as Error).message);
      const all = { ...ov };
      delete all[id];
      setOv(all);
      await reloadEntry();
    }
  }
}

// ------------------------------------------------------------------ the tracking sheet
/**
 * The hub reads the owner's tracking sheet tabs itself. Opening Entry does it quietly (the hub reads at most every ten minutes);
 * the Read the sheet button does it on demand.
 */
export async function readSheet(o: EntryOwner | undefined, force: boolean, say: boolean): Promise<void> {
  if (!o || !o.tab) {
    if (say) toast('This tracking sheet has no tab for ' + (o ? o.name : 'this person') + ' yet. Use Paste rows.');
    return;
  }
  try {
    const res = await wcPost<{ added?: string[]; skipped?: number }>('/api/work/entry/sheet', { owner: o.fid, force: !!force });
    const n = (res.added || []).length;
    if (n) await reloadEntry();
    if (say) toast(n ? `Read ${plural(n, 'new row')} from the tracking sheet${res.skipped ? `. ${res.skipped} were already here` : ''}.` : res.skipped ? `Nothing new. All ${res.skipped} rows on the sheet are already here.` : 'Nothing new on the sheet.');
  } catch (err) {
    if (say) toast((err as Error).message);
  }
}
