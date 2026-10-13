import { HttpError, nowIso } from '../../../_lib/http';
import { work, body } from '../../../_lib/work/route';
import { mayCadence } from '../../../_lib/work/cadence-svc';
import { SYSTEM_ID } from '../../../_lib/work/partner';

// Set or clear the No texts flag on a partner. Hub only: the text step on Cadence goes off for them with the reason shown.
export const onRequestPost = work(async ({ request, env, ctx }) => {
  if (!mayCadence(ctx.scope)) throw new HttpError(403, 'not_yours', 'The text flag is for Partner Care.');
  const b = await body(request);
  const cid = String(b.cid || '');
  if (!SYSTEM_ID.test(cid)) throw new HttpError(400, 'bad_partner', 'Pick a partner.');
  if (b.on === false) {
    await env.DB.prepare('DELETE FROM cad_no_text WHERE cid = ?').bind(cid).run();
    return { cid, on: false };
  }
  const reason = String(b.reason || 'Replied STOP').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Replied STOP';
  await env.DB.prepare('INSERT INTO cad_no_text (cid, reason, set_by, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(cid) DO UPDATE SET reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at')
    .bind(cid, reason, ctx.actor || ctx.email, nowIso()).run();
  return { cid, on: true, reason };
});
