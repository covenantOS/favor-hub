// What a row is (ready, needs a record, in Blackbaud ...) and which rows a lane shows. Ports of rowState, visibleIntake and
// weekCounts in public/js/work.js.
import type { EntryOwner, EntryRow, Lane } from './types';

export type StateKind = 'posted' | 'saving' | 'queued' | 'fail' | 'dup' | 'skip' | 'pick' | 'ready';
export interface RowState {
  k: StateKind;
  l: string;
  note?: string;
}

export interface StateCtx {
  saving: Record<string, string>;
  queued: Record<string, string>;
  fd: (iso: string, yr?: boolean) => string;
}

export function rowState(r: EntryRow, c: StateCtx): RowState {
  if (r.state === 'posted') return { k: 'posted', l: 'Entered', note: r.posted ? 'Entered ' + c.fd(r.posted.at.slice(0, 10)) + (r.posted.by ? ' by ' + r.posted.by.split(' ')[0] : '') : '' };
  if (r.state === 'posting' || c.saving[r.id] === 'saving') {
    // A change saved for tonight (or for when Blackbaud answers) says so instead of showing a spinner that never ends.
    if (c.queued[r.id] && c.saving[r.id] !== 'saving') return { k: 'queued', l: 'Queued', note: c.queued[r.id] };
    return { k: 'saving', l: 'Saving' };
  }
  if (r.state === 'failed' || c.saving[r.id] === 'failed') return { k: 'fail', l: 'Not sent', note: 'Blackbaud did not answer. Try again.' };
  if (r.state === 'in_blackbaud') return { k: 'dup', l: 'In Blackbaud', note: r.dup ? `Entered ${c.fd(r.dup.added)}${r.dup.same ? '' : ', dated a day apart'}` : 'Ticked on the sheet' };
  if (r.state === 'skipped') return { k: 'skip', l: 'Skipped' };
  if (!r.cid) return { k: 'pick', l: r.cands.length ? 'Pick a record' : 'Find the partner' };
  if (!r.ch) return { k: 'pick', l: 'Pick how' };
  return { k: 'ready', l: 'Ready' };
}

/** A locked row cannot be edited or selected. */
export const isLocked = (k: StateKind) => k === 'dup' || k === 'posted' || k === 'saving' || k === 'queued';

/** The rows one lane shows: This week, Late, In Blackbaud or All rows. */
export function laneRows(rows: EntryRow[], owner: string, lane: Lane, c: StateCtx): EntryRow[] {
  return rows
    .filter((r) => r.owner === owner)
    .filter((r) => {
      const s = rowState(r, c).k;
      if (lane === 'wait') return r.wk === 'this' && s !== 'dup' && s !== 'posted' && s !== 'skip';
      if (lane === 'late') return r.wk !== 'this' && s !== 'dup' && s !== 'posted' && s !== 'skip';
      if (lane === 'in') return s === 'dup' || s === 'posted';
      return true;
    });
}

export const byDate = (a: EntryRow, b: EntryRow) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);

export function weekCounts(owners: EntryOwner[], fid: string) {
  const o = owners.find((x) => x.fid === fid);
  return o ? { sub: o.sub, inBB: o.inBB, wait: o.wait, late: o.late, in: o.in, all: o.all } : { sub: 0, inBB: 0, wait: 0, late: 0, in: 0, all: 0 };
}

/** The lane to open on after choosing a person: This week if anything waits, else Late, else All rows. */
export function laneFor(owners: EntryOwner[], fid: string): Lane {
  const w = weekCounts(owners, fid);
  return w.wait ? 'wait' : w.late ? 'late' : 'all';
}

export const MATCH_HOW: Record<string, string> = { email: 'matched by email', phone: 'matched by phone', name: 'matched by name', picked: 'picked' };
export const SOURCE_LABEL = (r: EntryRow) => (r.source === 'many' ? 'One contact, many partners' : r.source === 'sheet' ? 'Tracking sheet' : r.source === 'paste' ? (r.row ? 'Sheet row ' + r.row : 'Pasted') : 'Typed');

/** "Smith, Jo - Ann's cousin" becomes "Jo Smith" for the search box on a row with no record yet. */
export const nameGuess = (name: string) => (name.split(' - ')[0] || '').replace(/^(.+?),\s*(.+)$/, '$2 $1');
