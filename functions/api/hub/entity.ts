import { resolveEntity, type EntityOut } from '../../_lib/hub/entity';
import { accessOf } from '../../_lib/hub/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// One FavorOS entity, or up to 24 at once, for the chip and hover card (public/js/favor-entity.js). The signed-in person's access applies to
// each: a partner needs the Work Center, a task needs Projects and its project, a meeting needs a seat in it. Anything not readable comes back
// `restricted` or missing, never with facts.
//   GET  ?kind=partner&id=123
//   POST { refs: [{ kind, id }] }  ->  { items: { "partner:123": EntityOut | null } }
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const access = await accessOf(env, request, user);
    const one = (kind: string, id: string) => resolveEntity(env, request, user, access, kind, id).catch(() => null);
    if (request.method === 'GET') {
      const u = new URL(request.url);
      const item = await one(u.searchParams.get('kind') || '', u.searchParams.get('id') || '');
      return json({ ok: true, item }, 200, { 'Cache-Control': 'private, max-age=60' });
    }
    if (request.method === 'POST') {
      const b = (await request.json().catch(() => ({}))) as { refs?: Array<{ kind?: string; id?: string }> };
      const refs = (Array.isArray(b.refs) ? b.refs : []).slice(0, 24);
      const items: Record<string, EntityOut | null> = {};
      await Promise.all(refs.map(async (r) => { items[`${r.kind}:${r.id}`] = await one(String(r.kind || ''), String(r.id || '')); }));
      return json({ ok: true, items }, 200, { 'Cache-Control': 'private, no-store' });
    }
    return errorJson('method', 'Use GET or POST.', 405);
  } catch (err) {
    return handleError(err);
  }
};
