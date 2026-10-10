// One pass over one deposit: send what is due, look at the batch, and copy photos once it is committed. The status page calls it for the
// deposit on screen; the drain route calls it for every open deposit through the morning, so a commit is noticed and the photos copy even
// when nobody has the page open. Every step is safe to run again.
import type { Env } from '../http';
import { attachmentsLeft, runAttachments } from './attach';
import { advance, pollBatch, type Ctx, type Watch } from './flow';
import { stageNeeds } from './stage';
import { getDeposit } from './store';
import { laneRow } from './view';

export interface Pass {
  watch: Watch | null;
  attach: { attached: number; waiting: number; failed: number } | null;
}

export async function runDeposit(env: Env, flow: Ctx, id: string, opts: { force?: boolean; minPollMs?: number } = {}): Promise<Pass> {
  const out: Pass = { watch: null, attach: null };
  const d = await getDeposit(env, id);
  if (!d) return out;
  if (d.status === 'sending') await advance(flow, id);
  const fresh = (await getDeposit(env, id))!;
  if (fresh.status === 'created') {
    // One batch-list call per poll. Throttled on the server: once a minute for a page, and once every ten minutes when the lane is past its warning line.
    const lane = await laneRow(env);
    const wait = lane.calls >= lane.warnAt ? 600_000 : opts.minPollMs ?? 50_000;
    const last = fresh.last_polled_at ? Date.parse(fresh.last_polled_at) : 0;
    if (opts.force || Date.now() - last >= wait) out.watch = await pollBatch(flow, id);
  }
  const now = (await getDeposit(env, id))!;
  if (now.status === 'committed' && stageNeeds(3)) {
    out.attach = await runAttachments(flow, id, {
      bytes: async (key) => {
        const o = await env.GIFT_CAPTURES.get(key);
        return o ? new Uint8Array(await o.arrayBuffer()) : null;
      },
    });
  }
  return out;
}

export { attachmentsLeft };
