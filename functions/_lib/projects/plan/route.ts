// Routes for planning, workload and the Friday update, mounted by the Projects router (../route.ts).
//   POST projects/plan/draft        { prompt, template?, date?, lead_email? }   a draft plan, saved nowhere
//   GET  projects/plan/templates                                                the templates and what each date means
//   POST projects/plan/create       { plan }                                    the project, its sections and tasks
//   GET  projects/workload          ?weeks=8 &team=                             every person's load by week, with warnings
//   POST projects/plan/check        { tasks: [{owner_email, due_date, priority}] }  warnings for a plan as edited
//   GET  projects/:id/status                                                    the Friday update switch and last post
//   PUT  projects/:id/status        { enabled }                                 owner only
//   GET  projects/:id/status/draft                                              this week's update as it would post
//   POST projects/:id/status/post                                               post it now (only when the update is on)
//   POST projects/status/run                                                    the scheduled pass (agent key)
import { HttpError, errorJson, json, type Env } from '../../http';
import type { HubUser } from '../../session';
import { projectStanding, type Actor } from '../access';
import { lower, projectOf } from '../db';
import { fire } from '../hooks';
import { shapeProject } from '../projects';
import { directory } from '../db';
import { createFromPlan } from './create';
import { draftPlan } from './draft';
import { TEMPLATES } from './templates';
import { assess, teamWorkload } from './workload';
import { channelOf, factsFor, postUpdate, runDue, setEnabled, statusOf, textFor } from './status';

interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  waitUntil: (p: Promise<unknown>) => void;
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export const isPlanPath = (path: string[]): boolean => {
  const [id, a, b] = path;
  return id === 'plan' || id === 'workload' || (id === 'status' && a === 'run') || (!!id && a === 'status' && (b === undefined || b === 'draft' || b === 'post'));
};

export async function planRoutes(ctx: Ctx, path: string[], actor: Actor): Promise<Response> {
  const { request, env } = ctx;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const [id, a, b] = path;

  if (id === 'plan') {
    if (a === 'templates' && method === 'GET') {
      return json({ ok: true, templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, anchor: t.anchor, lead: t.lead })) });
    }
    if (a === 'draft' && method === 'POST') {
      const x = await body(request);
      const prompt = String(x.prompt || '').trim();
      if (prompt.length < 3) throw new HttpError(400, 'missing_field', 'Describe the project in a sentence.');
      const d = await draftPlan(env, actor, { prompt, template: typeof x.template === 'string' ? x.template : undefined, date: typeof x.date === 'string' ? x.date : null, lead_email: typeof x.lead_email === 'string' ? x.lead_email : undefined });
      return json({ ok: true, ...d });
    }
    if (a === 'check' && method === 'POST') {
      const x = await body(request);
      const tasks = Array.isArray(x.tasks) ? (x.tasks as Record<string, unknown>[]).slice(0, 80) : [];
      const adds = tasks
        .map((t) => ({ email: lower(t.owner_email), due: String(t.due_date || ''), priority: String(t.priority || 'normal') }))
        .filter((t) => t.email && /^\d{4}-\d{2}-\d{2}$/.test(t.due));
      return json({ ok: true, warnings: await assess(env, adds) });
    }
    if (a === 'create' && method === 'POST') {
      const r = await createFromPlan(env, actor, await body(request));
      await fire(env, { kind: 'project.created', actor: actor.email, actorName: actor.name, project: r.project }, ctx.waitUntil);
      const dir = await directory(env);
      return json({ ok: true, project: shapeProject(r.project, { open: r.tasks.length, done: 0, overdue: 0 }, dir), tasks: r.tasks.length, told: r.told, warnings: r.warnings }, 201);
    }
    return errorJson('method', 'Not allowed.', 405);
  }

  if (id === 'workload') {
    if (method !== 'GET') return errorJson('method', 'Not allowed.', 405);
    return json({ ok: true, ...(await teamWorkload(env, actor, { weeks: Number(url.searchParams.get('weeks')) || 8, team: url.searchParams.get('team') || '' })) });
  }

  if (id === 'status' && a === 'run') {
    if (method !== 'POST') return errorJson('method', 'Not allowed.', 405);
    if (ctx.user?.via !== 'agent') throw new HttpError(403, 'forbidden', 'Only the scheduler runs this.');
    return json({ ok: true, ...(await runDue(env)) });
  }

  // projects/:id/status[/draft|/post]
  const p = await projectOf(env, id);
  const st = await projectStanding(env, actor, p);
  if (!st.see) throw new HttpError(403, 'forbidden', 'You do not have access to that.');
  if (!b) {
    if (method === 'GET') {
      return json({ ok: true, status: await statusOf(env, p.id), channel: await channelOf(env, p), can: { manage: st.manage } });
    }
    if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
      const x = await body(request);
      const r = await setEnabled(env, actor, p.id, x.enabled === true);
      return json({ ok: true, ...r, can: { manage: st.manage } });
    }
    return errorJson('method', 'Not allowed.', 405);
  }
  if (b === 'draft' && method === 'GET') {
    const f = await factsFor(env, p);
    return json({ ok: true, text: await textFor(env, f), facts: f.counts, week: f.week });
  }
  if (b === 'post' && method === 'POST') {
    if (!st.manage) throw new HttpError(403, 'forbidden', 'Only the project lead or an admin can post the update.');
    const r = await postUpdate(env, p, actor.email);
    return json({ ok: true, message_id: r.message_id, channel: r.channel });
  }
  return errorJson('method', 'Not allowed.', 405);
}
