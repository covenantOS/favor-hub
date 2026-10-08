import { kpiBase, kpiToken } from '../../_lib/hub/kpi';
import { type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

function page(message: string, status: number): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>KPI dashboard</title>
<style>body{font:15px/1.5 Montserrat,system-ui,sans-serif;color:#12161a;background:#f3f4f6;display:grid;place-items:center;min-height:90vh;margin:0}
p{max-width:30em;background:#fff;border:1px solid #e4e7eb;border-radius:12px;padding:20px 22px}</style><p>${message}</p>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * Hands a signed-in person over to the KPI dashboard: a two-minute token signed with the dashboard's
 * own key, which the dashboard trades for its usual session at /auth/hub. The hub page /dashboard/
 * opens this in a frame, so the KPI pages show inside the hub as they are.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = hubUserOf(request);
  if (!user || user.via !== 'google') return page('Sign in to the hub with your Favor Google account first.', 401);
  if (!user.kpi) return page('The KPI dashboard is open to leadership in the hub. Ask Will if you need it.', 403);
  const asked = new URL(request.url).searchParams.get('next') || '/';
  const next = /^\/(?![\\/])/.test(asked) ? asked : '/';
  try {
    const token = await kpiToken(env, { email: user.email, name: user.name, purpose: 'hub' }, 120);
    const to = new URL(kpiBase(env) + '/auth/hub');
    to.searchParams.set('t', token);
    to.searchParams.set('next', next);
    return new Response(null, { status: 302, headers: { Location: to.toString(), 'Cache-Control': 'no-store' } });
  } catch {
    return page('The KPI dashboard is not connected to the hub yet.', 503);
  }
};
