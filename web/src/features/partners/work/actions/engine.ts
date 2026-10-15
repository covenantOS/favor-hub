// Writing to Blackbaud through the hub, the way public/js/work.js does it: the hub saves the batch first (so nothing is lost if Blackbaud
// is down), then the page asks it to send the next 15 until nothing is left. Each answer says which rows reached Blackbaud; a failure
// stays on its row. Every write goes to the same /api/work routes (batches, run, undo, retry) with the same bodies.
import type { QueryClient } from '@tanstack/react-query';
import { asParam, reqId, sleep, wcPost, WcError } from './api';
import { indexOf, makeWork, type Index, type Work } from './model';
import { boardQuery, recentQuery } from './queries';
import { wcGet, wcSet, setMany, setSaving, resetPending, clearSel, nextSeq, type WcState } from './store';
import type { Act, Batch, BoardData, Meter } from './types';

let qcRef: QueryClient | null = null;
/** Called once by the page: the engine reads and refetches the board and Recent through this client. */
export function bindClient(qc: QueryClient) {
  qcRef = qc;
}
export const getClient = (): QueryClient => {
  if (!qcRef) throw new Error('The Work Center is not ready yet.');
  return qcRef;
};

/** The board as it is in the cache now (the engine runs from events, after the page has drawn). */
export function boardNow(): Index | null {
  const d = getClient().getQueryData<BoardData>(boardQuery(asParam()).queryKey);
  return d ? indexOf(d) : null;
}
export function workNow(): Work | null {
  const idx = boardNow();
  if (!idx) return null;
  const s = wcGet();
  return makeWork(idx, s);
}
export const meterNow = (): Meter => wcGet().meter || boardNow()?.data.meter || { used: 0, cap: 3000, lane: 2400, resets: '8:00 PM' };

// ------------------------------------------------------------------ toast, progress
export function toast(msg: string, bid?: string) {
  wcSet({ toast: { id: nextSeq(), msg, bid } });
}
export const hideToast = () => wcSet({ toast: null });
export function setBusy(label: string) {
  wcSet({ busy: { label, done: 0, total: 1 } });
}
export function progress(done: number, total: number, text?: string) {
  wcSet((s) => (s.busy ? { busy: { ...s.busy, done, total, text } } : {}));
}
export const clearBusy = () => wcSet({ busy: null });

// ------------------------------------------------------------------ reads the engine refreshes
/** Read the board again. The server lays this person's pending changes over Blackbaud's copy, so the overlays reset with it. */
export async function refreshBoard(): Promise<void> {
  const qc = getClient();
  try {
    await qc.fetchQuery({ ...boardQuery(asParam()), staleTime: 0 });
    resetPending();
  } catch {
    // the page keeps what it has
  }
}
export async function loadRecent(): Promise<Batch[]> {
  const qc = getClient();
  try {
    return await qc.fetchQuery({ ...recentQuery(asParam()), staleTime: 0 });
  } catch {
    return qc.getQueryData<Batch[]>(recentQuery(asParam()).queryKey) || [];
  }
}
export const recentNow = () => getClient().getQueryData<Batch[]>(recentQuery(asParam()).queryKey) || [];
export const reloadEntry = () => getClient().invalidateQueries({ queryKey: ['work', 'entry'] });

// ------------------------------------------------------------------ cost and the daily budget
const CHUNK = 15;
// Each changed action is read back once by the sync worker afterwards (1 Blackbaud call, 2 with tags), so the plan adds those.
export const costOf = (n: number, extraPerItem = 0) => n + Math.ceil(n * extraPerItem) + Math.ceil(n / CHUNK) + n;
// Mark complete: 1 PATCH each. Logged as a thank-you: an RDD, PC or CED task is completed in place (PATCH + Thanked tag = 2);
// a Follow Up task gets a new completed contact (POST + tag) and is then closed (PATCH) = 4 with its two tags. Plus one read-back per 15.
export function completeCost(ids: string[], how: string, byId: Record<string, Act>) {
  const thank = how && how !== 'none' && how !== 'logged';
  return ids.reduce((n, id) => n + (thank && byId[id]?.ty ? (byId[id].type === 'Follow Up - New Gift' ? 3 + 3 : 2 + 2) : 1 + 1), 0) + Math.ceil(ids.length / CHUNK);
}
export const estCreate = (rows: { tags: string[]; ch: string; ask: string }[]) => {
  const tags = rows.reduce((n, r) => n + r.tags.length + (r.ch === 'text' ? 1 : 0) + (r.ask ? 1 : 0), 0);
  return rows.length + tags + Math.ceil(rows.length / CHUNK) + rows.length * 2;
};
/** The Work Center may use 2,400 of the 3,000 upkeep calls a day. A change that would cross it waits for the reset. */
export function budgetLine(calls: number, meter: Meter = meterNow()): { tonight: boolean } {
  const left = meter.lane - (meter.used || 0);
  return { tonight: calls > 15 && calls > left };
}

// ------------------------------------------------------------------ running a batch
let guard: ((e: BeforeUnloadEvent) => void) | null = null;
function guardTab(on: boolean) {
  if (on && !guard) {
    guard = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
  }
  if (!on && guard) {
    window.removeEventListener('beforeunload', guard);
    guard = null;
  }
}
const VERB: Record<string, string> = { Marked: 'Marking', Closed: 'Closing', Reassigned: 'Reassigning', Moved: 'Moving', Entered: 'Entering' };

interface RunItem {
  id: string;
  state: string;
  error?: string;
}
interface RunAnswer {
  items: RunItem[];
  left: number;
  held?: string;
  meter?: Meter;
}
export interface DriveJob {
  /** Called for each row Blackbaud took (not for an undo). */
  onPosted?: (id: string) => void;
  onFailed?: (id: string, error?: string) => void;
  keep?: boolean;
  entry?: boolean;
}
/** Ask the hub to send the batch 15 at a time until nothing is left. Returns how many went and why it stopped early, if it did. */
export async function driveBatch(bid: string, ids: string[], job: DriveJob = {}, opts: { undo?: boolean } = {}): Promise<{ done: number; held: string; posted: string[] }> {
  guardTab(true);
  let done = 0;
  let held = '';
  let busyWaits = 0;
  let idle = 0;
  const total = ids.length;
  const posted: string[] = [];
  try {
    for (let guardN = 0; guardN < 400; guardN++) {
      const r = await wcPost<RunAnswer>(`/api/work/batches/${bid}/run`);
      if (r.meter) wcSet({ meter: r.meter });
      for (const it of r.items) {
        if (it.state === 'posted') {
          done++;
          setSaving(it.id, null);
          posted.push(it.id);
          if (!job.keep && !job.entry && !opts.undo) setMany('leaving', [it.id], 1);
          if (!opts.undo && job.onPosted) job.onPosted(it.id);
        } else if (it.state === 'failed') {
          setSaving(it.id, 'failed');
          if (job.onFailed) job.onFailed(it.id, it.error);
        }
      }
      progress(Math.min(done, total), total, opts.undo ? `Undoing… ${Math.min(done, total)} of ${total}` : undefined);
      if (r.held === 'busy') {
        if (++busyWaits > 20) {
          held = 'busy';
          break;
        }
        await sleep(1500);
        continue;
      }
      if (r.held) {
        held = r.held;
        break;
      }
      if (!r.left) break;
      // Two rounds in a row that sent nothing and failed nothing: Blackbaud is not taking calls. Stop, keep what is saved, and let the person try again later.
      idle = r.items.some((it) => it.state === 'posted' || it.state === 'failed') ? 0 : idle + 1;
      if (idle >= 2) {
        held = 'wait';
        break;
      }
      if (idle) await sleep(2000);
    }
  } catch (e) {
    held = 'error';
    wcSet({ lastError: (e as Error).message });
  } finally {
    guardTab(false);
  }
  return { done, held, posted };
}

export interface Job {
  params: Record<string, unknown>;
  ids: string[];
  label: string;
  calls: number;
  tonight: boolean;
  /** The rows leave every list when Blackbaud has them (mark complete, close). */
  gone?: boolean;
  /** Entry rows: the batch is created from submissions. */
  entry?: boolean;
  keep?: boolean;
  /** What to lay over a row once Blackbaud has taken its change. */
  apply?: (id: string) => void;
}

const doneId = (id: string, job: Job, s: WcState) => (job.entry ? false : !!s.gone[id] || !!s.ov[id]);

export async function runJob(job: Job): Promise<void> {
  const ids = job.ids.slice();
  clearSel();
  hideToast();
  const saved = (m: Record<string, string>) => ({ ...wcGet().saving, ...m });
  wcSet({ saving: saved(Object.fromEntries(ids.map((id) => [id, 'saving']))) });
  setBusy(`${job.label.replace(/^(\w+)/, (m) => VERB[m] || m)}…`);
  const req = reqId(); // one per press: a second click or a retry after a lost answer gets this same batch back
  let out: { batch?: { id?: string; run_when?: string }; items?: { id: string }[]; changed?: number };
  try {
    out = await wcPost('/api/work/batches', { ...job.params, ...(job.entry ? { op: 'create', submission_ids: ids } : { ids }), req });
  } catch (e) {
    setMany('saving', ids, null);
    clearBusy();
    toast((e as Error).message || 'Blackbaud did not answer. Nothing was changed.');
    return;
  }
  const batch = out.batch || {};
  let label = job.label;
  if (out.changed) label += ` (${out.changed} left alone: changed in Blackbaud since your list loaded)`;
  const handled = new Set((out.items || []).map((i) => String(i.id)));
  setMany('saving', ids.filter((id) => !handled.has(id)), null);
  const meter = meterNow();
  if (!batch.id) {
    clearBusy();
    toast(job.entry ? 'Those contacts are already in Blackbaud. Nothing was added twice.' : 'Those actions were already handled. Reload the list if it looks out of date.');
    void refreshBoard();
    if (job.entry) void reloadEntry();
    return;
  }
  const sent = ids.filter((id) => handled.has(id));
  if (batch.run_when === 'tonight') {
    const word = job.params.op === 'complete' || job.params.op === 'close_thanked' ? 'Marked complete · goes to Blackbaud tonight' : 'Change goes to Blackbaud tonight';
    setMany('saving', sent, null);
    setMany('queued', sent, word);
    clearBusy();
    toast(`${label}. Blackbaud gets ${sent.length === 1 ? 'it' : 'them'} after ${meter.resets}.`, batch.id);
    void refreshBoard();
    void loadRecent();
    if (job.entry) void reloadEntry();
    return;
  }
  const res = await driveBatch(batch.id, sent, { keep: job.keep, entry: job.entry });
  // Rows that went leave every list now; the fade (is-leaving) ran while the batch was sending.
  if (job.apply) res.posted.forEach((id) => job.apply!(id));
  wcSet((s) => ({ saving: Object.fromEntries(Object.entries(s.saving).filter(([, v]) => v === 'failed')), leaving: {} }));
  if (res.held && res.held !== 'error') {
    const s = wcGet();
    setMany(
      'queued',
      sent.filter((id) => !s.saving[id] && !doneId(id, job, s)),
      res.held === 'off' || res.held === 'wait' ? 'Saved · waiting to send' : 'Goes to Blackbaud tonight'
    );
  }
  await loadRecent();
  clearBusy();
  const failed = Object.values(wcGet().saving).filter((v) => v === 'failed').length;
  const m2 = wcGet().meter || meter;
  if (res.held === 'error') toast(`${wcGet().lastError || 'Blackbaud did not answer.'} What was not sent stays saved. Open Recent to try again.`, batch.id);
  else if (res.held === 'wait') toast('Blackbaud is not taking changes right now. Yours are saved. Open Recent and press Try again in a few minutes.', batch.id);
  else if (res.held === 'off') toast('Sending to Blackbaud is switched off. Your changes are saved and go when it is switched back on.', batch.id);
  else if (res.held) toast(`${label}. The rest goes to Blackbaud after ${m2.resets}.`, batch.id);
  else toast(failed ? `${label.replace(/^(\w+) (\d+)/, (_m, v, n) => v + ' ' + Math.max(0, Number(n) - failed))}. ${failed} did not go through.` : label + '.', batch.id);
  await refreshBoard();
  if (job.entry) void reloadEntry();
}

// ------------------------------------------------------------------ undo and retry
const undoingSet = (): Set<string> => {
  const w = window as unknown as { favorUndoing?: Set<string> };
  return (w.favorUndoing = w.favorUndoing || new Set());
};
const setUndoing = (bid: string, on: boolean) => {
  const g = undoingSet();
  if (on) g.add(bid);
  else g.delete(bid);
  wcSet({ undoing: new Set(g) });
};
export const isUndoing = (bid: string) => wcGet().undoing.has(bid);

/** After Recent is read again: a change that is undone, or whose undo is still being sent, keeps its button off. */
function settleUndo(bid: string) {
  const b = recentNow().find((x) => x.id === bid);
  if (!b || (!b.undone && !b.undoing)) setUndoing(bid, false);
}
const sleepMs = sleep;

export async function undoBatch(bid: string): Promise<void> {
  if (undoingSet().has(bid)) return;
  const other = recentNow().find((x) => x.id === bid && x.mine === false);
  if (other && !confirm('This change was made by ' + (other.actor || 'someone else') + '. Undo it for them?')) return;
  setUndoing(bid, true);
  hideToast();
  let out: { batch?: { id?: string }; queued?: boolean; tagsStay?: boolean; unresolved?: number };
  try {
    out = await wcPost(`/api/work/batches/${bid}/undo`, other ? { confirm: true } : undefined);
  } catch (e) {
    // Already undone, or being undone: the button stays off. Any other failure puts it back.
    const data = (e as WcError).data || {};
    const again = data.error === 'already_undone' || data.error === 'undo_of_undo';
    if (!again) setUndoing(bid, false);
    toast((e as Error).message);
    if (again) {
      await loadRecent();
      settleUndo(bid);
    }
    return;
  }
  if (out.queued) {
    // The first write was still on its way. Undo is saved, the row is back in the list, and the server sends the reversal when the first write lands.
    await refreshBoard();
    await loadRecent();
    toast('Undone. Blackbaud gets the reversal as soon as it finishes the first change.');
    for (let i = 0; i < 8; i++) {
      await sleepMs(2500);
      const r = (await loadRecent()).find((x) => x.id === bid);
      if (!r || r.undone) break;
    }
    await refreshBoard();
    settleUndo(bid);
    return;
  }
  const b = out.batch;
  if (b && b.id) {
    setBusy('Undoing…');
    const items = (recentNow().find((x) => x.id === bid) || { items: [] }).items.filter((i) => i.state === 'posted').map((i) => i.id);
    await driveBatch(b.id, items.length ? items : ['x'], {}, { undo: true });
    clearBusy();
  }
  await refreshBoard();
  await loadRecent();
  void reloadEntry();
  settleUndo(bid);
  toast('Undone.' + (out.tagsStay ? ' The Thanked and Texted tags stay on those actions in Blackbaud.' : '') + (out.unresolved ? ` ${out.unresolved} contact${out.unresolved === 1 ? '' : 's'} need a look in Blackbaud. Recent lists them.` : ''));
}

export async function retryBatch(bid: string): Promise<void> {
  let out: { requeued?: number };
  try {
    out = await wcPost(`/api/work/batches/${bid}/retry`);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  const b = recentNow().find((x) => x.id === bid);
  const ids = b ? b.items.filter((i) => i.state === 'failed').map((i) => i.id) : [];
  setBusy('Trying again…');
  const res = await driveBatch(bid, ids.length ? ids : ['x'], {});
  clearBusy();
  await refreshBoard();
  await loadRecent();
  void reloadEntry();
  toast(res.held ? 'Blackbaud did not answer. What did not go through stays saved.' : `Tried ${out.requeued || ''} again.`);
}

// ------------------------------------------------------------------ one change from the edit panel, an inline pop or a dialog
export type SayState = 'saving' | 'saved' | 'queued' | 'failed' | 'conflict';
export interface SendOpts {
  label?: string;
  nothing?: string;
  /** The status line (the panel's footer, a row's tag): called with the state and the words. */
  say?: (state: SayState, text: string, conflict?: { fields: string[]; current: Record<string, unknown> }) => void;
  /** Put an optimistic change back when Blackbaud turned it down. */
  revert?: () => void;
  after?: () => Promise<unknown> | void;
}
/** Save a change as a batch, send it, and report one of four states: saving, saved, queued or failed. Undo is on the toast and in Recent. */
export async function sendChange(params: Record<string, unknown>, o: SendOpts = {}): Promise<{ ok: boolean; none?: boolean; queued?: boolean; batch?: string; held?: string; conflict?: unknown; error?: string }> {
  const say = o.say || (() => undefined);
  const req = reqId();
  say('saving', 'Saving…');
  let saved: { batch?: { id?: string; run_when?: string }; items?: { id: string }[] };
  try {
    saved = await wcPost('/api/work/batches', { ...params, req });
  } catch (e) {
    const err = e as WcError;
    if (err.data && err.data.error === 'conflict') {
      say('conflict', err.message, err.data.conflict as { fields: string[]; current: Record<string, unknown> });
      return { ok: false, conflict: err.data.conflict };
    }
    say('failed', err.message || 'Blackbaud did not answer. Nothing was changed.');
    if (o.revert) o.revert();
    return { ok: false, error: err.message };
  }
  const b = saved.batch || {};
  if (!b.id) {
    say('saved', o.nothing || 'Nothing needed changing.');
    return { ok: true, none: true };
  }
  const meter = meterNow();
  if (b.run_when === 'tonight') {
    say('queued', 'Saved. Blackbaud gets it after ' + meter.resets + '.');
    toast((o.label || 'Saved') + '. It goes to Blackbaud tonight.', b.id);
    void loadRecent();
    return { ok: true, queued: true, batch: b.id };
  }
  const ids = (saved.items || []).map((i) => String(i.id)).filter(Boolean);
  const r = await driveBatch(b.id, ids.length ? ids : ['x'], { keep: true });
  const recent = await loadRecent();
  const rec = recent.find((x) => x.id === b.id);
  const failed = rec ? rec.items.filter((i) => i.state === 'failed') : [];
  if (failed.length) {
    const why = failed[0].error || 'Blackbaud turned it down.';
    say('failed', why);
    toast(`${o.label || 'Change'}: ${why}`, b.id);
    if (o.revert) o.revert();
  } else if (r.held) {
    say('queued', r.held === 'wait' || r.held === 'error' ? 'Saved. Blackbaud is not taking changes right now; it goes when it answers.' : 'Saved. Blackbaud gets it after ' + meter.resets + '.');
    toast((o.label || 'Saved') + '. Waiting to send.', b.id);
  } else {
    say('saved', 'Saved to Blackbaud ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    toast(o.label || 'Saved.', b.id);
  }
  if (o.after) await o.after();
  void refreshBoard();
  return { ok: !failed.length, batch: b.id, held: r.held };
}

