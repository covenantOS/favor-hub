// The toast at the foot of the Work Center list tabs, with Undo for one or two saved changes (batches), and the sending and undoing
// the classic thank.js did. Every change goes through /api/work/batches: saved first, sent to Blackbaud 15 at a time by
// /api/work/batches/:id/run, checked, and undone from here for 24 hours.
import { useEffect, useSyncExternalStore } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';
import { sleep, workApi, workPost, WorkError } from './core';
import { Ic } from './icons';

export interface ToastUndo {
  /** Batch ids: Undo sends the reversal of each. */
  batches?: string[];
  /** Or a function: Undo runs it (the Asks close date). */
  run?: () => void | Promise<void>;
}
interface ToastState {
  n: number;
  msg: string;
  bad: boolean;
  undo: ToastUndo | null;
  on: boolean;
  /** 'wg' is the pill the thank-you form used; 'wc' is the Work Center's own. */
  look: 'wg' | 'wc';
}
let state: ToastState = { n: 0, msg: '', bad: false, undo: null, on: false, look: 'wg' };
const subs = new Set<() => void>();
let hide: ReturnType<typeof setTimeout> | undefined;
const emit = () => subs.forEach((f) => f());
const set = (p: Partial<ToastState>) => {
  state = { ...state, ...p };
  emit();
};

// The changes whose Undo was pressed, shared with the classic pages: a change is undone once.
function undoing(): Set<string> {
  const w = window as unknown as { favorUndoing?: Set<string> };
  return (w.favorUndoing = w.favorUndoing || new Set());
}

export function showToast(msg: string, o: { undo?: ToastUndo | null; bad?: boolean; look?: 'wg' | 'wc'; ms?: number } = {}) {
  clearTimeout(hide);
  const hasUndo = !!(o.undo && ((o.undo.batches && o.undo.batches.length) || o.undo.run));
  set({ n: state.n + 1, msg, bad: !!o.bad, undo: hasUndo ? o.undo! : null, on: true, look: o.look || 'wg' });
  hide = setTimeout(() => set({ on: false }), o.ms ?? (hasUndo ? 10000 : msg.endsWith('…') ? 30000 : 4800));
}
export const hideToast = () => {
  clearTimeout(hide);
  set({ on: false });
};

/* ------------------------------------------------------------------ sending */

/** Send a saved batch until it is done or held. Resolves to what held it ('' when all went). */
export async function driveBatch(bid: string): Promise<string> {
  let held = '';
  for (let i = 0; i < 60; i++) {
    const r = await workPost(`/api/work/batches/${bid}/run`);
    if (r.held === 'busy') {
      await sleep(1500);
      continue;
    }
    if (r.held) {
      held = r.held;
      break;
    }
    if (!r.left) break;
    await sleep(1200);
  }
  return held;
}

/** The first failed item's message for these batches, read from Recent, or null. */
export async function failureOf(bids: string[]): Promise<string | null> {
  try {
    const recent = (await workApi('/api/work/recent')).batches || [];
    for (const b of recent) if (bids.includes(b.id)) {
      const f = (b.items || []).find((x: any) => x.state === 'failed');
      if (f) return f.error || 'Blackbaud turned it down.';
    }
  } catch {
    // the change is saved; the toast still offers Undo
  }
  return null;
}

/** Words for how a send ended, then the toast. held: '' (sent), 'tonight' or anything else (slow). */
export function sentToast(what: string, held: string, bids: string[]) {
  showToast(held === 'tonight' ? `${what}. It goes to Blackbaud tonight.` : held ? `${what}. Blackbaud is slow, so the rest goes when it answers.` : what + '.', { undo: { batches: bids } });
}

/* ------------------------------------------------------------------ undoing */

export const UNDONE_EVENT = 'favor:thanked-undone';

async function settleUndo(ids: string[]) {
  try {
    const recent = (await workApi('/api/work/recent')).batches || [];
    ids.forEach((bid) => {
      const b = recent.find((x: any) => x.id === bid);
      if (!b || (!b.undone && !b.undoing)) undoing().delete(bid);
    });
  } catch {
    // the button stays off until the page reloads
  }
}

/** Undo these batches (once each). Tells every list through the favor:thanked-undone event, the one the classic pages use. */
export async function undoBatches(ids0: string[]) {
  const U = undoing();
  const ids = ids0.filter(Boolean).filter((bid) => !U.has(bid));
  if (!ids.length) return;
  ids.forEach((bid) => U.add(bid));
  const snap = (window as unknown as { WCSnap?: { forgetBatch: (b: string) => void } }).WCSnap;
  if (snap) ids.forEach((bid) => snap.forgetBatch(bid));
  showToast('Undoing…');
  let at = '';
  let queued = false;
  try {
    for (const bid of ids) {
      at = bid;
      try {
        const r = await workPost(`/api/work/batches/${bid}/undo`);
        if (r.batch && r.batch.id) await driveBatch(r.batch.id);
        if (r.queued) queued = true;
      } catch (e) {
        // Already undone, or being undone: it is on its way back and the button stays off.
        if (!(e instanceof WorkError && e.data && e.data.error === 'already_undone')) throw e;
      }
    }
    await settleUndo(ids);
    showToast(queued ? 'Undone. Blackbaud gets the reversal as soon as it finishes the first change.' : 'Undone.');
    document.dispatchEvent(new CustomEvent(UNDONE_EVENT, { detail: { batches: ids } }));
    // Reading Recent applies a saved press once the first write has landed, so a short wait finishes it even if no other page is open.
    if (queued)
      for (let i = 0; i < 6; i++) {
        await sleep(2500);
        try {
          const rc = (await workApi('/api/work/recent')).batches || [];
          if (ids.every((bid) => { const b = rc.find((x: any) => x.id === bid); return !b || b.undone; })) {
            U.delete(ids[0]);
            break;
          }
        } catch {
          // try again
        }
      }
  } catch (e) {
    ids.slice(ids.indexOf(at)).forEach((bid) => U.delete(bid)); // the one that failed and the ones not tried
    showToast((e as Error).message, { bad: true });
  }
}

/* ------------------------------------------------------------------ the toast itself */

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
const snapshot = () => state;

/** Draw once per page. Z presses Undo while the toast shows. */
export function WorkToast() {
  const t = useSyncExternalStore(subscribe, snapshot, snapshot);
  const canUndo = !!t.undo;
  useEffect(() => {
    if (!t.on || !canUndo) return;
    const k = (e: KeyboardEvent) => {
      if ((e.key !== 'z' && e.key !== 'Z') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      press();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  const batches = t.undo?.batches || [];
  const off = batches.length > 0 && typeof window !== 'undefined' && batches.every((x) => undoing().has(x));
  return BodyPortal(
    <div
      className={(t.look === 'wc' ? 'wc-toast' : 'pp-toast wg-toast') + (t.on ? ' is-on' : '') + (canUndo ? (t.look === 'wc' ? ' wc-toast--undo' : ' wg-toast--undo') : '')}
      role="status"
      aria-live="polite"
    >
      {t.msg ? (
        <>
          {t.look === 'wc' ? (
            <span className="ok">
              <Ic n="check" />
            </span>
          ) : null}
          <span className={t.bad ? 'is-bad' : ''}>{t.msg}</span>
          {canUndo ? (
            <button type="button" className={'h-btn h-btn--ghost ' + (t.look === 'wc' ? 'wc-undo-btn' : 'wg-undo-btn')} title="Undo (Z)" aria-keyshortcuts="Z" disabled={off} aria-busy={off || undefined} onClick={press}>
              <Ic n="undo" />
              Undo
              <kbd>Z</kbd>
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function press() {
  const u = state.undo;
  if (!u) return;
  if (u.run) {
    const f = u.run;
    set({ undo: null, on: false });
    void f();
    return;
  }
  if (u.batches && u.batches.length) {
    // The button goes off at once; undoBatches fills the shared set before its first await.
    void undoBatches(u.batches);
    emit();
  }
}
