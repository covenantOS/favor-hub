// Saving a change to Blackbaud the way every Work Center change goes: saved as a batch, sent 15 at a time, checked, and undone from the
// toast for 24 hours. Used by My partners (+ Task, Plan calls, Trip planner).
import { driveBatch, failureOf, showToast } from './toast';
import { reqId, workPost } from './core';

export interface BatchOutcome {
  batch?: string;
  ok?: boolean;
  none?: boolean;
  queued?: boolean;
  failed?: number;
}

/** Save params as one batch and send it. Resolves to null when nothing could be saved. The toast says how it ended. */
export async function sendBatch(params: Record<string, unknown>, label: string): Promise<BatchOutcome | null> {
  let saved: any;
  try {
    saved = await workPost('/api/work/batches', { ...params, req: reqId() });
  } catch (e) {
    showToast((e as Error).message || 'Blackbaud did not answer. Nothing was changed.', { look: 'wc' });
    return null;
  }
  const b = saved.batch || {};
  if (!b.id) {
    showToast('Nothing needed changing.', { look: 'wc' });
    return { none: true };
  }
  if (b.run_when === 'tonight') {
    showToast(label + '. It goes to Blackbaud tonight.', { look: 'wc', undo: { batches: [b.id] } });
    return { batch: b.id, queued: true };
  }
  let held = '';
  try {
    held = await driveBatch(b.id);
  } catch (e) {
    showToast((e as Error).message + ' It is saved, and Recent can send it again.', { look: 'wc', undo: { batches: [b.id] } });
    return { batch: b.id, failed: 1 };
  }
  const bad = await failureOf([b.id]);
  if (bad) {
    showToast(label + ': ' + bad, { look: 'wc', undo: { batches: [b.id] } });
    return { batch: b.id, failed: 1 };
  }
  showToast(held ? label + '. Waiting to send.' : label, { look: 'wc', undo: { batches: [b.id] } });
  return { batch: b.id, ok: true };
}
