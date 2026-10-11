import { body, work } from '../../../_lib/work/route';
import { GROUPS, PRESETS, ROLE_AREAS, STATES, createJob, listJobs, statusWords } from '../../../_lib/work/bbuser-jobs';

// Blackbaud user requests, admins only. GET lists the latest requests with their status and the choices the form offers. POST saves a
// request for the desktop automation to run (add a user, change access, deactivate). Nothing here touches Blackbaud.
export const onRequestGet = work(async ({ env }) => {
  const jobs = await listJobs(env);
  return {
    jobs: jobs.map((j) => ({ id: j.id, kind: j.kind, email: j.target_email, name: j.target_name, state: j.state, status: statusWords(j.state), by: j.requested_by, at: j.requested_at, finished: j.finished_at, result: j.result, access: (JSON.parse(j.payload || '{}') as { access?: unknown }).access || null })),
    open: jobs.filter((j) => j.state === 'queued' || j.state === 'running' || j.state === 'checked').length,
    form: { roles: ROLE_AREAS, groups: GROUPS, presets: PRESETS, states: STATES },
  } as any;
}, { adminOnly: true });

export const onRequestPost = work(async ({ env, request, wu }) => {
  const b = await body(request);
  const job = await createJob(env, { actor: wu.actor, email: wu.email }, { kind: b.kind, email: b.email, first: b.first, last: b.last, preset: b.preset, access: b.access });
  return { id: job.id, state: job.state, status: statusWords(job.state) } as any;
}, { adminOnly: true });
