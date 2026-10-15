import { work, param } from '../../../../../_lib/work/route';
import { requireFgl } from '../../../../../_lib/fgl/gate';
import { getBatch } from '../../../../../_lib/fgl/store';
import { HttpError, nowIso } from '../../../../../_lib/http';

// The print file as made. The first time it is fetched, the page starts asking for the gifts to be marked.
export const onRequestGet = work(async ({ ctx, params, url }) => {
  requireFgl(ctx);
  const batch = await getBatch(ctx.env, param(params, 'id'));
  const obj = await ctx.env.UPLOADS.get(batch.pdf_key);
  if (!obj) throw new HttpError(404, 'gone', 'The print file is missing from storage.');
  if (!batch.downloaded_at && (batch.status === 'printing' || batch.status === 'marking')) {
    await ctx.env.DB.prepare('UPDATE fgl_batches SET downloaded_at = ? WHERE id = ? AND downloaded_at IS NULL').bind(nowIso(), batch.id).run();
  }
  const name = `first-gift-letters-${batch.letter_date}`;
  const mode = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${mode}; filename="${name}.pdf"`, 'Cache-Control': 'no-store' },
  });
});
