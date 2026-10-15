// Writes through /api/work/batches, the way the Work Center and the classic partner page do: save the batch, send it to Blackbaud with
// /run until nothing is left, read Recent to see whether Blackbaud turned a row down, and offer Undo on the toast for 24 hours.
import { ApiFail, newReq, rApi, rPost, sleep } from './lib';
import { markUndoing, toast } from './toast';

export interface RunOpts {
  /** Called with the server's conflict list when a row changed in Blackbaud after the person opened the form. */
  onConflict?: (data: any) => void;
}

/** Send a batch to Blackbaud. Resolves to the batch id (or true), or false when it failed (the toast says why). */
export async function runBatch(params: Record<string, unknown>, label: string, after?: (bid: string) => void, opts?: RunOpts): Promise<string | boolean> {
  toast('Saving…');
  let out: any;
  try {
    out = await rPost('/api/work/batches', { req: newReq(), ...params });
  } catch (e) {
    const err = e as ApiFail;
    if (err.data && err.data.error === 'conflict' && opts?.onConflict) {
      toast('');
      opts.onConflict(err.data);
      return false;
    }
    toast(err.message, null, true);
    return false;
  }
  const b = out.batch || {};
  if (b.id && b.run_when !== 'tonight') {
    for (let i = 0; i < 40; i++) {
      let r: any;
      try {
        r = await rPost(`/api/work/batches/${b.id}/run`);
      } catch (e) {
        toast((e as Error).message, b.id, true);
        return false;
      }
      if (!r.left || r.held) break;
      await sleep(1200);
    }
    try {
      const rec = ((await rApi('/api/work/recent')).batches || []).find((x: any) => x.id === b.id);
      const bad = rec && rec.items.find((i: any) => i.state === 'failed');
      if (bad) {
        toast(bad.error || 'Blackbaud turned it down.', b.id, true);
        return false;
      }
    } catch {
      // the change is saved; the toast still offers Undo
    }
  }
  toast(b.run_when === 'tonight' ? label + '. It goes to Blackbaud tonight.' : label + '.', b.id);
  if (after) after(b.id);
  return b.id || true;
}

/** Send a batch until nothing is left. Returns '' when it went, 'tonight' when it waits, or the reason it is held. */
export async function drive(bid: string): Promise<string> {
  let held = '';
  for (let i = 0; i < 60; i++) {
    const r: any = await rPost(`/api/work/batches/${bid}/run`);
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

async function settleUndo(ids: string[]) {
  try {
    const recent = ((await rApi('/api/work/recent')).batches || []) as any[];
    ids.forEach((bid) => {
      const b = recent.find((x) => x.id === bid);
      if (!b || (!b.undone && !b.undoing)) markUndoing([bid], false);
    });
  } catch {
    // the button stays off until the page reloads
  }
}

/** Undo one or more batches. Each is undone once; the page that asked hears favor:undone and reads the record again. */
export async function undoBatches(all: string[]) {
  const ids = all.filter(Boolean);
  if (!ids.length) return;
  markUndoing(ids, true);
  toast('Undoing…');
  let at = '';
  let queued = false;
  try {
    for (const bid of ids) {
      at = bid;
      try {
        const r: any = await rPost(`/api/work/batches/${bid}/undo`);
        if (r.batch && r.batch.id) await drive(r.batch.id);
        if (r.queued) queued = true;
      } catch (e) {
        // Already undone, or being undone: it is on its way back and the button stays off.
        if (!((e as ApiFail).data && (e as ApiFail).data.error === 'already_undone')) throw e;
      }
    }
    await settleUndo(ids);
    toast(queued ? 'Undone. Blackbaud gets the reversal as soon as it finishes the first change.' : 'Undone.');
    document.dispatchEvent(new CustomEvent('favor:undone', { detail: { batches: ids } }));
    document.dispatchEvent(new CustomEvent('favor:thanked-undone', { detail: { batches: ids } }));
    if (queued) {
      for (let i = 0; i < 6; i++) {
        await sleep(2500);
        try {
          const rc = ((await rApi('/api/work/recent')).batches || []) as any[];
          if (ids.every((bid) => { const b = rc.find((x) => x.id === bid); return !b || b.undone; })) {
            markUndoing([ids[0]], false);
            break;
          }
        } catch {
          // try again
        }
      }
    }
  } catch (e) {
    // the one that failed and the ones not tried
    markUndoing(ids.slice(ids.indexOf(at)), false);
    toast((e as Error).message, null, true);
  }
}
