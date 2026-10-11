import { body, work } from '../../../../_lib/work/route';
import { cancelJob } from '../../../../_lib/work/bbuser-jobs';

// Take back a Blackbaud user request the desktop has not started. Admins only.
export const onRequestPost = work(async ({ env, request, wu }) => {
  const b = await body(request);
  const row = await cancelJob(env, { actor: wu.actor, email: wu.email }, String(b.id || ''));
  return { id: row.id, state: 'cancelled' } as any;
}, { adminOnly: true });
