// The Work Center's page state that outlives one component: the person's own pending changes laid over the board, the selection, the
// filters and sort, the toast, the progress bar and the open dialog. It is a small external store (useSyncExternalStore), not React
// state, because a batch keeps running after the person switches to another view and its answers must still land somewhere.
// Only events and effects write to it, so the server always draws from INIT.
import { useSyncExternalStore, type ReactNode } from 'react';
import type { Meter, Overlay, WorkFilters } from './types';
import { EMPTY_FILTERS } from './types';

export interface ToastState {
  id: number;
  msg: string;
  /** The batch the Undo button on the toast reverses. */
  bid?: string;
}
export interface BusyState {
  label: string;
  done: number;
  total: number;
  text?: string;
}
export interface WcState {
  // Pending changes laid over the board until it is read again (public/js/work.js S.ov, S.gone, S.saving, S.queued, S.back).
  ov: Record<string, Overlay>;
  gone: Record<string, 1>;
  saving: Record<string, string>;
  queued: Record<string, string>;
  back: Record<string, 1>;
  /** Rows whose change reached Blackbaud during a run: they fade out until the run ends. */
  leaving: Record<string, 1>;
  meter: Meter | null;
  // The selection on the list being shown (action ids, thank-you group keys or Entry row ids).
  sel: ReadonlySet<string>;
  anchor: string | null;
  // Open actions, Stale and Thank-yous.
  f: WorkFilters;
  sort: string;
  dir: 1 | -1;
  stLane: string;
  tyOwner: string;
  tyLane: string;
  openB: string | null;
  toast: ToastState | null;
  busy: BusyState | null;
  dialog: { id: number; node: ReactNode } | null;
  undoing: ReadonlySet<string>;
  lastError: string;
  /** The saved start scope has been applied to the filters once this page load. */
  scopeApplied: boolean;
  /** The saved start tab has been applied once this page load. */
  startApplied: boolean;
}

const NONE: ReadonlySet<string> = new Set();
export const INIT: WcState = {
  ov: {},
  gone: {},
  saving: {},
  queued: {},
  back: {},
  leaving: {},
  meter: null,
  sel: NONE,
  anchor: null,
  f: EMPTY_FILTERS,
  sort: 'due',
  dir: -1,
  stLane: 'left',
  tyOwner: '',
  tyLane: '',
  openB: null,
  toast: null,
  busy: null,
  dialog: null,
  undoing: NONE,
  lastError: '',
  scopeApplied: false,
  startApplied: false,
};

let state: WcState = INIT;
const subs = new Set<() => void>();
export const wcGet = () => state;
export function wcSet(patch: Partial<WcState> | ((s: WcState) => Partial<WcState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** Read one part of the state. The selector must return a value that only changes when that part changes. */
export function useWc<T>(sel: (s: WcState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(INIT));
}

// Small writers the lists and the engine share.
export const setSaving = (id: string, v: string | null) =>
  wcSet((s) => {
    const n = { ...s.saving };
    if (v == null) delete n[id];
    else n[id] = v;
    return { saving: n };
  });
export const setMany = (key: 'saving' | 'queued' | 'gone' | 'back' | 'leaving', ids: string[], v: string | 1 | null) =>
  wcSet((s) => {
    const n = { ...(s[key] as Record<string, string | 1>) };
    for (const id of ids) {
      if (v == null) delete n[id];
      else n[id] = v;
    }
    return { [key]: n } as Partial<WcState>;
  });
export const setOverlay = (id: string, o: Overlay) => wcSet((s) => ({ ov: { ...s.ov, [id]: { ...s.ov[id], ...o } } }));
export const dropOverlay = (id: string, key?: keyof Overlay) =>
  wcSet((s) => {
    const n = { ...s.ov };
    if (key && n[id]) {
      const c = { ...n[id] };
      delete c[key];
      n[id] = c;
    } else delete n[id];
    return { ov: n };
  });
export const setGone = (ids: string[], on: boolean) => setMany('gone', ids, on ? 1 : null);
/** A fresh board has every pending change of this person laid over it by the server. */
export const resetPending = () => wcSet({ gone: {}, ov: {}, back: {}, leaving: {}, meter: null });

export const setSel = (ids: Iterable<string>, anchor?: string | null) => wcSet((s) => ({ sel: new Set(ids), anchor: anchor === undefined ? s.anchor : anchor }));
export const clearSel = () => wcSet({ sel: NONE, anchor: null });
export const setFilters = (f: Partial<WorkFilters>) => wcSet((s) => ({ f: { ...s.f, ...f }, sel: NONE, anchor: null }));

let seq = 0;
export const openDialog = (node: ReactNode) => wcSet({ dialog: { id: ++seq, node } });
export const closeDialog = () => wcSet({ dialog: null });
export const nextSeq = () => ++seq;
