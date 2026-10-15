// The filters live in the page address (q, owner, due, status, code, done) so a link or a reload keeps them. Ported from the top of
// public/js/projects/filters.js.
import { STATUS } from '../lib/dates';
import type { TaskCtx } from '../lib/store';
import type { Task } from '../types';

export const DUE: Record<string, string> = { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', none: 'No date' };
export const FILTER_KEYS = ['q', 'owner', 'due', 'status', 'code'] as const;

export interface FilterSeed {
  q: string;
  owner: string;
  due: string;
  status: string;
  code: string;
  done: boolean;
}

/** The filters named in an address. */
export function filtersFrom(sp: URLSearchParams): FilterSeed {
  const f: FilterSeed = { q: sp.get('q') || '', owner: sp.get('owner') || '', due: sp.get('due') || '', status: sp.get('status') || '', code: sp.get('code') || '', done: false };
  if (!DUE[f.due]) f.due = '';
  if (f.status && !STATUS[f.status]) f.status = '';
  f.done = f.status === 'done' || sp.get('done') === '1';
  return f;
}

/** Put address filters into the store (without loading anything). */
export function applyFilters(ctx: TaskCtx, f: FilterSeed): void {
  for (const k of FILTER_KEYS) ctx.filter[k] = f[k];
}

/** Write the store's filters into a URLSearchParams. */
export function writeFilters(ctx: TaskCtx, p: URLSearchParams): void {
  for (const k of FILTER_KEYS) {
    if (ctx.filter[k]) p.set(k, ctx.filter[k]);
    else p.delete(k);
  }
  if (ctx.showDone) p.set('done', '1');
  else p.delete('done');
}

export const activeCount = (ctx: TaskCtx): number => FILTER_KEYS.filter((k) => k !== 'q' && ctx.filter[k]).length + (ctx.filter.priority ? 1 : 0);

export function codesIn(tasks: Task[]): [string, string][] {
  const m = new Map<string, string>();
  for (const t of tasks) {
    for (const [f, label] of [['appeal_code', 'Appeal'], ['source_code', 'Source'], ['fund_code', 'Fund'], ['campaign_code', 'Campaign']] as const) {
      const c = t[f];
      if (c && !m.has(c)) m.set(c, label);
    }
  }
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}
