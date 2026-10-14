// The scheduled jobs and the smoke check as one short answer, for Will's morning email (re-nxt-cloud-sync, Tech account, calls this
// with the hub agent key). It reads hub_cron_runs through the same rules as Admin > Overview and adds any job that failed in the last
// 24 hours and has run well since, so an overnight failure still shows the next morning. It changes nothing.
import { agentKeyOk } from '../../_lib/testuser';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { JOBS, jobStates, type JobRow } from '../../_lib/admin/cronruns';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!agentKeyOk(env, request) && !(user && user.role === 'admin')) return errorJson('forbidden', 'Agent key or an admin only.', 403);
    const now = Date.now();
    const states = await jobStates(env, now);
    const rows = ((await env.DB.prepare('SELECT * FROM hub_cron_runs').all<JobRow>()).results || []) as JobRow[];
    const label = new Map(JOBS.map((j) => [j.id, j.label]));
    const bad = states.filter((s) => s.status === 'failed' || s.status === 'late').map((s) => ({ id: s.id, label: s.label, status: s.status, at: s.at, detail: s.detail }));
    const badIds = new Set(bad.map((b) => b.id));
    const recovered = rows
      .filter((r) => r.error_at && now - Date.parse(r.error_at) < 24 * 3600_000 && !badIds.has(r.job))
      .map((r) => ({ id: r.job, label: label.get(r.job) || r.job, at: r.error_at, error: String(r.last_error || '').slice(0, 160) }));
    const smoke = states.find((s) => s.id === 'smoke') || null;
    return json({ ok: true, at: new Date(now).toISOString(), jobs: states.length, bad, recovered, smoke });
  } catch (err) {
    return handleError(err);
  }
};
