import { work, param } from '../../../../_lib/work/route';
import { noteUndoable, partnerNotes } from '../../../../_lib/work/edit';

// Notes on the partner record, read live from Blackbaud (one call, kept ten minutes). A note this hub saved in the last 24 hours carries the batch that made it, so Undo shows on it.
export const onRequestGet = work(async ({ ctx, params, url }) => {
  const id = param(params, 'id');
  const rows = await partnerNotes(ctx, id, url.searchParams.get('fresh') === '1');
  const undo = await noteUndoable(ctx.env, id);
  return { rows: rows.map((n: any) => (undo[String(n.id)] ? { ...n, undo: undo[String(n.id)] } : n)) };
});
