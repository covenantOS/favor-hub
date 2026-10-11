import { work } from '../../../_lib/work/route';
import { logGrant } from '../../../_lib/work/grants-svc';
import { HttpError } from '../../../_lib/http';

// Log a request, LOI, report or task on a foundation, with the file attached when one is picked (a form post). Saved as an ordinary
// batch (Recent and Undo apply); the page then sends it with .../batches/:id/run.
export const onRequestPost = work(async ({ request, ctx }) => {
  const form = await request.formData().catch(() => null);
  if (!form) throw new HttpError(400, 'bad_form', 'The form did not arrive. Try again.');
  const s = (k: string) => String(form.get(k) ?? '');
  const f = form.get('file') as unknown as File | null;
  return (await logGrant(ctx, { cid: s('cid'), kind: s('kind'), how: s('how'), state: s('state'), date: s('date'), summary: s('summary'), notes: s('notes'), req: s('req'), file: f && typeof (f as any).arrayBuffer === 'function' ? f : null })) as any;
});
