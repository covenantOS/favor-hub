import { gift } from '../../_lib/gifts/route';
import { attachmentsLeft } from '../../_lib/gifts/attach';
import { runDeposit } from '../../_lib/gifts/runner';
import { stageNeeds } from '../../_lib/gifts/stage';
import { laneRow } from '../../_lib/gifts/view';
import { resumeBatches } from '../../_lib/other-gifts/post';

// The morning pass (the small drain Worker calls it every ten minutes from 6 AM to 2 PM Eastern): notice that Jennifer approved a batch,
// finish any step that waited for a retry or the daily reset, and copy photos. Unapproved batches are polled at most every ten minutes.
export const onRequestPost = gift(async ({ env, flow }) => {
  if (!stageNeeds(2)) return { skipped: 'stage 1' };
  const since = new Date(Date.now() - 5 * 86400000).toISOString();
  const rows = (await env.DB.prepare("SELECT id, status FROM ge_deposit WHERE status IN ('sending', 'created', 'committed') AND created_at >= ? ORDER BY created_at LIMIT 12").bind(since).all<{ id: string; status: string }>()).results;
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (r.status === 'committed' && (await attachmentsLeft(env, r.id)) === 0) continue;
    const p = await runDeposit(env, flow, r.id, { minPollMs: 840_000 });
    out.push({ id: r.id, was: r.status, polled: !!p.watch, committed: !!(p.watch && p.watch.approved), attached: p.attach ? p.attach.attached : 0 });
  }
  // Other gifts: a batch a second person approved keeps posting through a wait or a retry, and a letter that waited attaches.
  const other = await resumeBatches({
    env,
    send: flow.send,
    letterBytes: async (key) => {
      const o = await env.GIFT_CAPTURES.get(key);
      return o ? new Uint8Array(await o.arrayBuffer()) : null;
    },
  }).catch(() => []);
  return { ran: out.length, deposits: out, other, lane: await laneRow(env) };
});
