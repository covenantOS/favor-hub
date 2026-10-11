import { body, work } from '../../../../_lib/work/route';
import { reportJob, statusWords } from '../../../../_lib/work/bbuser-jobs';

// The desktop automation reports what it did: checked (stopped at the confirm screen), done or failed, with one plain line. Admins and the agent key only.
export const onRequestPost = work(async ({ env, request, wu }) => {
  const b = await body(request);
  const row = await reportJob(env, { actor: wu.actor, email: wu.email }, { id: b.id, state: b.state, result: b.result });
  return { id: row.id, state: b.state, status: statusWords(b.state) } as any;
}, { adminOnly: true });
