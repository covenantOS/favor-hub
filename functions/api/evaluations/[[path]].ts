import { handleError, HttpError, json, type Env } from '../../_lib/http';
import { SheetError } from '../../_lib/hub/sheets';
import { hubUserOf } from '../../_lib/session';
import { sameSite } from '../../_lib/work/route';
import { asJson, handle } from '../../_lib/evals/api';

// Evaluations: one route for the whole area. Access rules live in functions/_lib/evals/service.ts.
// The morning job may call POST /api/evaluations/admin/nudge with the agent key to send the day's reminders.
const run: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
    if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That change did not come from FavorOS. Reload the page and try again.');
    const raw = params.path;
    const path = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.json().catch(() => ({}));
    const out = await handle(env, { email: user.email, name: user.name, role: user.role }, request.method, path, body, new URL(request.url), { waitUntil });
    return asJson(out);
  } catch (err) {
    // Google not connected, or asked once more for Sheets: the page shows the same plain prompt as the Favor Brain.
    if (err instanceof SheetError) return json({ ok: false, error: err.code, message: err.message, ...err.extra }, err.code === 'consent' || err.code === 'not_connected' ? 200 : err.status);
    return handleError(err);
  }
};

export const onRequest = run;
