import { body, work } from '../../../../_lib/work/route';
import { claimJob } from '../../../../_lib/work/bbuser-jobs';

// The desktop automation asks for its next Blackbaud user request. takeChecked also hands back a request it only checked before, for a
// run that is allowed to apply. Answers { job: null } when nothing waits. Admins and the agent key only.
export const onRequestPost = work(async ({ env, request }) => {
  const b = await body(request);
  const job = await claimJob(env, { takeChecked: b.takeChecked === true });
  return { job: job ? { id: job.id, kind: job.kind, email: job.target_email, name: job.target_name, payload: JSON.parse(job.payload || '{}'), attempts: job.attempts } : null } as any;
}, { adminOnly: true });
