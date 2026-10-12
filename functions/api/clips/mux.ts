// Clips: the fast-start job, for a hub admin. Lists where every clip stands and runs the job for clips that are not done
// (clips recorded before the job existed, or ones that failed). See functions/_lib/clipmuxjob.ts.
//   GET  /api/clips/mux                    counts by state and the clips still waiting or failed
//   POST /api/clips/mux {id?, retry?}      one run (about 25 seconds) for that clip, or for the next one waiting.
//                                          retry also takes a clip that failed. Call it until `left` is 0.
//                                          {stage: "plan"} reads the recording and stops before the new file is written.
import { errorJson, handleError, json } from '../../_lib/http';
import { ID_RE, J, adminOrError, type ClipsEnv } from '../../_lib/clips';
import { muxRun, muxStep } from '../../_lib/clipmuxjob';

const HEADERS = { 'Cache-Control': 'private, no-store' };
const LIVE = "status IN ('ready', 'processing')";

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const counts = await env.DB.prepare(`SELECT mux, COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM hub_clips WHERE ${LIVE} GROUP BY mux`).all<{ mux: string; n: number; bytes: number }>();
    const open = await env.DB.prepare(`SELECT id, mux, mux_info, mux_at, mime, size_bytes, duration_ms, created_at FROM hub_clips WHERE ${LIVE} AND mux IN ('', 'plan', 'error') ORDER BY created_at DESC LIMIT 200`).all<Record<string, unknown>>();
    return json({ ok: true, counts: counts.results || [], open: (open.results || []).map((r) => ({ ...r, mux_info: J<unknown>(r.mux_info, null) })) }, 200, HEADERS);
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const body = (await request.json().catch(() => ({}))) as { id?: string; retry?: boolean; stage?: string };
    let id = typeof body.id === 'string' && ID_RE.test(body.id) ? body.id : '';
    if (body.id && !id) return errorJson('bad_id', 'That is not a clip id.', 400);
    if (!id) {
      // The next clip nobody is working on. With retry, failed clips and ones parked after three tries count too.
      const next = body.retry
        ? await env.DB.prepare(`SELECT id FROM hub_clips WHERE ${LIVE} AND mux IN ('', 'plan', 'error') ORDER BY created_at LIMIT 1`).first<{ id: string }>()
        : await env.DB.prepare(`SELECT id FROM hub_clips WHERE ${LIVE} AND mux IN ('', 'plan') AND (mux_at IS NULL OR mux_at < ?) ORDER BY created_at LIMIT 1`).bind(new Date(Date.now() - 60_000).toISOString()).first<{ id: string }>();
      id = next ? next.id : '';
    }
    if (!id) return json({ ok: true, id: null, left: 0 }, 200, HEADERS);
    if (body.retry) {
      // A failed clip starts again from the recording. One parked while writing gets its tries back.
      await env.DB.prepare("UPDATE hub_clips SET mux_info = CASE WHEN mux = 'plan' THEN json_remove(mux_info, '$.tries') ELSE '' END, mux = CASE WHEN mux = 'error' THEN '' ELSE mux END, mux_at = NULL WHERE id = ? AND mux IN ('', 'plan', 'error')").bind(id).run();
    }
    const state = body.stage === 'plan' ? await muxStep(env, id, { stage: 'plan', budgetMs: 25_000 }) : await muxRun(env, id, 25_000);
    const row = await env.DB.prepare('SELECT mux_info FROM hub_clips WHERE id = ?').bind(id).first<{ mux_info: string }>();
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM hub_clips WHERE ${LIVE} AND mux IN ('', 'plan')`).first<{ n: number }>();
    return json({ ok: true, id, state, info: J<unknown>(row?.mux_info, null), left: left ? left.n : 0 }, 200, HEADERS);
  } catch (err) {
    return handleError(err);
  }
};
