// The toast at the bottom of the screen, with Undo for one or more batches. One element for the partner page, the drawer and the tools
// (classic partner.js and thank.js each drew their own; both looks are kept: v 'pp' for the partner page, v 'wg' for the thank-you).
import { useSyncExternalStore } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { Ic } from './Ic';
import { undoBatches } from './writes';

export interface ToastState {
  msg: string;
  bids: string[];
  bad: boolean;
  on: boolean;
  v: 'pp' | 'wg';
  seq: number;
}
let state: ToastState = { msg: '', bids: [], bad: false, on: false, v: 'pp', seq: 0 };
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** The changes whose Undo was pressed: a change is undone once. Mirrored to window.favorUndoing so the classic pages see it too. */
const UNDO = new Set<string>();
export const undoing = (): Set<string> => UNDO;
export function markUndoing(ids: string[], on: boolean) {
  const w = typeof window !== 'undefined' ? (window as unknown as { favorUndoing?: Set<string> }) : null;
  const shared = w ? (w.favorUndoing = w.favorUndoing || new Set<string>()) : null;
  ids.forEach((i) => {
    if (on) {
      UNDO.add(i);
      shared?.add(i);
    } else {
      UNDO.delete(i);
      shared?.delete(i);
    }
  });
  emit();
}

/** Show a message. bids adds an Undo button for those batches. */
export function toast(msg: string, bids?: string | string[] | null, bad?: boolean, v: 'pp' | 'wg' = 'pp') {
  const list = bids ? (Array.isArray(bids) ? bids : [bids]).filter(Boolean) : [];
  state = { msg, bids: list, bad: !!bad, on: !!msg, v, seq: state.seq + 1 };
  emit();
  clearTimeout(timer);
  const ms = list.length ? (v === 'wg' ? 10000 : 9000) : msg.endsWith('…') ? 30000 : v === 'wg' ? 4800 : 4200;
  timer = setTimeout(() => {
    state = { ...state, on: false };
    emit();
  }, ms);
}
export const hideToast = () => {
  state = { ...state, on: false };
  emit();
};

const server: ToastState = { msg: '', bids: [], bad: false, on: false, v: 'pp', seq: 0 };

/** Mounted once (by PartnerLinks or the partner page). */
export function ToastHost() {
  const s = useSyncExternalStore(subscribe, () => state, () => server);
  const off = s.bids.length > 0 && s.bids.every((x) => UNDO.has(x));
  const press = () => {
    if (off) return;
    markUndoing(s.bids, true);
    void undoBatches(s.bids);
  };
  return BodyPortal(
    <div className={'pp-toast' + (s.v === 'wg' ? ' wg-toast' : '') + (s.v === 'wg' && s.bids.length ? ' wg-toast--undo' : '') + (s.on ? ' is-on' : '')} role="status" id={s.v === 'wg' ? 'wg-toast' : undefined}>
      <span className={s.bad ? 'is-bad' : ''}>{s.msg}</span>
      {s.bids.length ? (
        s.v === 'wg' ? (
          <button type="button" className="h-btn h-btn--ghost wg-undo-btn" title="Undo (Z)" aria-keyshortcuts="Z" disabled={off} aria-busy={off || undefined} onClick={press}>
            <Ic n="undo" />
            Undo<kbd>Z</kbd>
          </button>
        ) : (
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={off} aria-busy={off || undefined} onClick={press}>
            Undo
          </button>
        )
      ) : null}
    </div>
  );
}
