// "Make a request" for the Marketing team. Off by default: the person is sent to the Asana form as before. When an admin picks a hub
// project in Admin > Projects (setting projects.marketing_key), the words become a task in that project instead.
//   GET  -> {ok, mode: 'asana'} or {ok, mode: 'project', project: {key, name}}
//   POST {text, route_id?} -> {ok, mode: 'project', task: {code, title, href}} or {ok, mode: 'asana'} when the setting is off
import { hitRateLimit } from '../../_lib/auth';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, newId, nowIso, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { effective } from '../../_lib/admin/settings';
import { projectsMode } from '../../_lib/projects/access';
import { addEvent, projectOf, taskById } from '../../_lib/projects/db';
import { fire } from '../../_lib/projects/hooks';
import { tell } from '../../_lib/projects/notices';

interface Target {
  id: string;
  key: string;
  name: string;
  lead: string;
}

async function target(env: Env): Promise<Target | null> {
  const key = (await effective(env, 'projects.marketing_key', undefined, '').catch(() => '')).trim().toUpperCase();
  if (!key) return null;
  if ((await projectsMode(env)) === 'off') return null;
  const p = await env.DB.prepare("SELECT id, key, name, lead_email AS lead FROM hub_projects WHERE key = ? AND status != 'archived'").bind(key).first<Target>().catch(() => null);
  return p || null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const t = await target(env);
    return json(t ? { ok: true, mode: 'project', project: { key: t.key, name: t.name } } : { ok: true, mode: 'asana' });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
    if (await hitRateLimit(env, `mktask:${clientIp(request)}`, 20, 600)) return errorJson('slow_down', 'Too many requests at once. Wait a minute and try again.', 429);
    const t = await target(env);
    if (!t) return json({ ok: true, mode: 'asana' });
    const body = (await request.json().catch(() => ({}))) as { text?: unknown; route_id?: unknown };
    const text = asTrimmed(body.text, 'text', 4000);
    if (text.length < 2) throw new HttpError(400, 'too_short', 'Say a little about what you need.');
    const title = text.split(/\n/)[0].slice(0, 160);
    const now = nowIso();
    const id = newId('tsk');
    const n = await env.DB.prepare('UPDATE hub_projects SET next_num = next_num + 1 WHERE id = ? RETURNING next_num - 1 AS n').bind(t.id).first<{ n: number }>();
    const code = `${t.key}-${String(n?.n ?? 0).padStart(4, '0')}`;
    const description = `${text}\n\nFrom Make a request, sent by ${user.name || user.email}.`.slice(0, 20000);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO hub_tasks (id, project_id, section_id, code, title, description, status, priority, owner_email, created_by, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, 'open', 'normal', ?, ?, ?, ?)`
      ).bind(id, t.id, code, title, description, t.lead, user.email, now, now),
      env.DB.prepare("INSERT OR IGNORE INTO hub_task_people (task_id, email, role) VALUES (?, ?, 'follower')").bind(id, user.email),
    ]);
    await addEvent(env, { task_id: id, project_id: t.id, actor: user.email, kind: 'created', detail: { title, via: 'make-a-request' } });
    const told = await tell(env, id, user.email, t.lead ? [{ email: t.lead, kind: 'assigned', body: title }] : []);
    fire(env, { kind: 'task.created', actor: user.email, actorName: user.name, task: await taskById(env, id), project: await projectOf(env, t.id), told }, waitUntil).catch(() => {});
    const routeId = typeof body.route_id === 'string' ? body.route_id.slice(0, 60) : '';
    if (routeId) await env.DB.prepare('UPDATE request_routes SET chosen = ?, chosen_at = ?, request_id = ? WHERE id = ?').bind('marketing', now, code, routeId).run().catch(() => {});
    return json({ ok: true, mode: 'project', task: { code, title, href: `/projects/p/?p=${encodeURIComponent(t.key)}&t=${encodeURIComponent(code)}` }, project: { key: t.key, name: t.name } });
  } catch (err) {
    return handleError(err);
  }
};
