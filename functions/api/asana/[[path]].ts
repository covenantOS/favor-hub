// /api/asana/*: the two-way Asana sync for Projects (functions/_lib/projects/sync.ts) and Connect Asana (sync-oauth.ts).
//   POST hook/<project gid>     Asana webhooks: the X-Hook-Secret handshake, then signed events (open at the middleware; checks the signature)
//   GET  oauth/connect?back=    sends the person to Asana's consent screen (format=url answers with the address instead)
//   GET  oauth/callback         Asana sends the person back here (open at the middleware; the signed state names the person)
//   GET  oauth/me, DELETE oauth/me   this person's connection
//   POST run                    the scheduled pass (agent key only)
//   GET  admin, POST admin {sync: on|off, require: on|off, extra: [emails], skip: [emails]}, POST admin/project {gid, enabled}   Admin > Projects (admins)
import { HttpError, errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { projectsActor } from '../../_lib/projects/access';
import { AsanaError, asanaUser, mustConnect, setRequire, adminState, runPass, setProjectSync, setSync, webhook } from '../../_lib/projects/sync';
import { connection, connectUrl, disconnect, finishConnect, tokenFor } from '../../_lib/projects/sync-oauth';

export const onRequest: PagesFunction<Env, 'path'> = async (ctx) => {
  const { request, env } = ctx;
  const path = ([] as string[]).concat((ctx.params.path as string[] | string) || []).filter(Boolean);
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  try {
    const [a, b] = path;
    if (a === 'hook' && b && method === 'POST') return await webhook(env, request, b, (p) => ctx.waitUntil(p));
    if (a === 'oauth' && b === 'callback') {
      const err = url.searchParams.get('error');
      if (err) return Response.redirect(new URL('/projects/?asana=declined', url).toString(), 302);
      const to = await finishConnect(env, String(url.searchParams.get('code') || ''), String(url.searchParams.get('state') || ''));
      return Response.redirect(new URL(to, url).toString(), 302);
    }
    const user = hubUserOf(request);
    if (a === 'run') {
      if (method !== 'POST') return errorJson('method', 'Not allowed.', 405);
      if (user?.via !== 'agent') throw new HttpError(403, 'forbidden', 'Only the scheduler runs this.');
      return json({ ok: true, ...(await runPass(env)) });
    }
    const actor = await projectsActor(env, request, user);
    if (a === 'oauth' && b === 'connect') {
      const to = await connectUrl(env, actor.email, String(url.searchParams.get('back') || '/projects/'));
      if (url.searchParams.get('format') === 'url') return json({ ok: true, url: to });
      return Response.redirect(to, 302);
    }
    if (a === 'oauth' && b === 'me') {
      if (method === 'GET') return json({ ok: true, ...(await connection(env, actor.email)), required: await mustConnect(env, actor.email).catch(() => false), asana_user: await asanaUser(env, actor.email).catch(() => false) });
      if (method === 'DELETE') {
        await disconnect(env, actor.email);
        return json({ ok: true, connected: false });
      }
      if (method === 'POST' && url.searchParams.get('refresh') === '1') {
        const t = await tokenFor(env, actor.email, true);
        return json({ ok: true, refreshed: !!t, ...(await connection(env, actor.email)) });
      }
      return errorJson('method', 'Not allowed.', 405);
    }
    if (a === 'admin') {
      if (!actor.admin) throw new HttpError(403, 'forbidden', 'Admins only.');
      if (!b && method === 'GET') return json({ ok: true, ...(await adminState(env)) });
      const body: any = await request.json().catch(() => ({}));
      if (!b && method === 'POST') {
        if (body.sync !== undefined) {
          if (body.sync !== 'on' && body.sync !== 'off') throw new HttpError(400, 'bad_sync', 'sync is on or off.');
          await setSync(env, actor.email, body.sync === 'on');
        }
        if (body.require !== undefined || body.extra !== undefined || body.skip !== undefined) await setRequire(env, actor.email, body);
        return json({ ok: true, ...(await adminState(env)) });
      }
      if (b === 'project' && method === 'POST') {
        const row = await setProjectSync(env, actor.email, String(body.gid || ''), body.enabled === true);
        return json({ ok: true, project: { gid: row?.project_gid, enabled: !!row?.enabled, hub_project_id: row?.hub_project_id, webhook: !!row?.webhook_gid } });
      }
    }
    return errorJson('not_found', 'No such route.', 404);
  } catch (err) {
    if (err instanceof AsanaError) return errorJson('asana', err.message, 502);
    return handleError(err);
  }
};
