// Undo for "Your recent changes". A port of the Undo half of public/js/thank.js, so Today no longer waits for that script to load.
// The same calls in the same order: POST /api/work/batches/<id>/undo, then POST /api/work/batches/<undo batch>/run until nothing is
// left, then GET /api/work/recent to see whether the change went back. The server holds the 24-hour rule (undo_until); the list on the
// page only offers Undo while that time is ahead of the clock. A change is undone once: the ids already pressed are kept in
// window.favorUndoing, the set the classic pages read too.
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';

type J = Record<string, any>;

class UndoError extends Error {
  data: J;
  constructor(message: string, data: J) {
    super(message);
    this.data = data;
  }
}

async function api(path: string, init: { method?: string } = {}): Promise<J> {
  const res = await fetch(path, { credentials: 'same-origin', method: init.method || 'GET', headers: { 'X-Hub-Request': '1', ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: init.method === 'POST' ? '{}' : undefined });
  const data = (await res.json().catch(() => ({}))) as J;
  if (!res.ok || data.ok === false) throw new UndoError(data.message || 'Something went wrong. Try again.', data);
  return data;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- which changes are being undone */
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();
const shared = (): Set<string> | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { favorUndoing?: Set<string> };
  return (w.favorUndoing = w.favorUndoing || new Set<string>());
};
function mark(ids: string[], on: boolean) {
  const s = shared();
  ids.forEach((id) => (on ? s?.add(id) : s?.delete(id)));
  snapshot = new Set(s || []);
  listeners.forEach((f) => f());
}
/** The ids whose Undo was pressed (here or on a classic page). Empty while the server draws, so both sides agree on the first paint. */
export function useUndoing(): ReadonlySet<string> {
  return useSyncExternalStore(
    (f) => {
      // The classic scripts may have added ids before this page mounted; take them in once subscribed.
      const s = shared();
      if (s && s.size !== snapshot.size) snapshot = new Set(s);
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => snapshot,
    () => snapshot,
  );
}

/* ---------------------------------------------------------------- the toast */
interface Toast {
  update: (m: string, o?: Record<string, unknown>) => unknown;
}
type HubToast = (m: string, o?: Record<string, unknown>) => Toast;
const toastFn = (): HubToast | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { hubToast?: HubToast }).hubToast);

/** Say something. window.hubToast draws it when the shell has loaded it; the classic Today toast is the fallback. */
function say(msg: string, tone: '' | 'busy' | 'ok' | 'bad' = ''): Toast | null {
  const t = toastFn();
  if (t) return t(msg, { tone });
  (window as unknown as { FavorTodayInbox?: { toast: (m: string, u?: null) => void } }).FavorTodayInbox?.toast(msg, null);
  return null;
}

/* ---------------------------------------------------------------- the press */
async function drive(bid: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const r = await api(`/api/work/batches/${bid}/run`, { method: 'POST' });
    if (r.held === 'busy') {
      await sleep(1500);
      continue;
    }
    if (r.held || !r.left) break;
    await sleep(1200);
  }
}

// After an undo: a change that is undone, or whose undo is still being sent, keeps its button off. When some rows did not go back, Undo opens again.
async function settle(ids: string[]) {
  try {
    const recent = ((await api('/api/work/recent')).batches || []) as J[];
    ids.forEach((bid) => {
      const b = recent.find((x) => x.id === bid);
      if (!b || (!b.undone && !b.undoing)) mark([bid], false);
    });
  } catch {
    // the button stays off until the page reloads
  }
}

/** Undo one change (a batch). Safe to call twice: a change already pressed is left alone. */
export async function undoChange(bid: string, qc: QueryClient): Promise<void> {
  const s = shared();
  if (!bid || (s && s.has(bid))) return;
  mark([bid], true);
  const w = window as unknown as { WCSnap?: { forgetBatch: (id: string) => void } };
  w.WCSnap?.forgetBatch(bid);
  const busy = say('Undoing…', 'busy');
  const finish = (m: string, tone: 'ok' | 'bad') => (busy ? busy.update(m, { tone }) : say(m, tone));
  const refresh = () => {
    // The keys of homeQ, todayQ and giftsQ in queries.ts.
    for (const k of ['home', 'hub', 'gifts']) void qc.invalidateQueries({ queryKey: ['today', k] });
  };
  let queued = false;
  try {
    try {
      const r = await api(`/api/work/batches/${bid}/undo`, { method: 'POST' });
      if (r.batch && r.batch.id) await drive(r.batch.id);
      if (r.queued) queued = true;
    } catch (e) {
      // Already undone, or being undone: it is on its way back and the button stays off.
      if (!((e as UndoError).data && (e as UndoError).data.error === 'already_undone')) throw e;
    }
    await settle([bid]);
    finish(queued ? 'Undone. Blackbaud gets the reversal as soon as it finishes the first change.' : 'Undone.', 'ok');
    document.dispatchEvent(new CustomEvent('favor:thanked-undone', { detail: { batches: [bid] } }));
    refresh();
    // Reading Recent applies a saved press once the first write has landed, so a short wait here finishes it even if no other page is open.
    if (queued) {
      for (let i = 0; i < 6; i++) {
        await sleep(2500);
        try {
          const rc = ((await api('/api/work/recent')).batches || []) as J[];
          const b = rc.find((x) => x.id === bid);
          if (!b || b.undone) {
            mark([bid], false);
            refresh();
            break;
          }
        } catch {
          // try again
        }
      }
    }
  } catch (e) {
    mark([bid], false); // the one that failed goes back to Undo
    finish((e as Error).message || 'That did not work. Try again.', 'bad');
  }
}
