// Requests inside Projects: /api/tasks/intake/*. Registered with registerTaskRoute('intake', ...) in functions/_lib/projects/hooks.ts, so it
// runs before the Projects mode check and does its own: anyone signed in with a Favor account may send a request and read their own,
// whatever the Projects release setting is. Triage needs ownership of a team's pipeline or a FavorOS admin (views.ts has the rules).
//
//   GET   mine[?all=1]                  my requests with where each one is (any signed-in person)
//   POST  parse        { text }         the composer's chips with the reason for each, and the staff list for the assignee chip
//   POST  submit       { text, team?, kind?, place?, audience?, due_date?, assignee?, title? }   or multipart: payload (JSON) + files
//                                       -> { request, parsed } or 409 { error: 'expense', href } for a request about money
//   GET   teams                         the teams I triage: pipeline project, sections, counts (for the Intake tab and its badge)
//   GET   queue[?team=&scope=intake|open|all]    the cards waiting on my teams
//   GET   r/:id                         one request in full: item, history, comments, files, what I may do
//   GET   r/:id/options                 where Accept can put it: projects I may add to, with their stages, and who it could go to
//   POST  r/:id/accept { project_id?, section_id?, owner_email?, due_date?, note? }
//   POST  r/:id/ask    { question }
//   POST  r/:id/decline { reason }
//   POST  r/:id/reply  { body }         the person who asked answers, or the owner adds a note
import { HttpError, errorJson, handleError, json, type Env } from '../http';
import { hitRateLimit } from '../auth';
import type { HubUser } from '../session';
import { actorOf, commentsOf, type Actor, type TaskEnv } from '../requests/tasks';
import { attachmentsFor, eventsFor } from '../db';
import { staffDirectory } from '../people';
import { lower } from '../projects/db';
import { acceptCard, askQuestion, declineCard, replyToRequest } from './triage';
import { intakeReady } from './pipeline';
import { acceptTargets, myItems, oneItem, queueItems, readableRequest, teamsOut, type QueueScope } from './views';
import { parseFor, submitRequest, type FileIn } from './submit';
import { buildItems } from './items';

export interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  /** ['intake', ...] */
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const body = async (request: Request): Promise<Record<string, unknown>> => asObject(await request.json().catch(() => null));
const noStore = { 'Cache-Control': 'private, no-store' };

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    return await route(ctx);
  } catch (err) {
    return handleError(err);
  }
}

/** The request, its history, comments and files, with what this person may do. Comments and history are for the people on the request. */
export async function requestDetail(env: TaskEnv, actor: Actor, id: string) {
  const { row, standing } = await readableRequest(env, actor, id);
  const { item } = await oneItem(env, actor, id);
  const [atts, events, comments] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id), commentsOf(env, id)]);
  const dir = new Map((await staffDirectory(env).catch(() => [])).map((p) => [p.email, p]));
  return {
    item,
    standing,
    attachments: (atts.get(id) || []).map((a) => ({ id: a.id, filename: a.filename, content_type: a.content_type, size_bytes: a.size_bytes, url: `/api/uploads/${a.r2_key}` })),
    comments: comments
      .filter((c) => !c.deleted_at)
      .map((c) => ({ id: c.id, body: c.body, at: c.created_at, by: { email: c.email, name: dir.get(lower(c.email))?.name || c.name || c.email.split('@')[0] }, mine: lower(c.email) === actor.email })),
    // The history lines for a triager include who did what; the asker reads the same lines the status page shows.
    history: events
      .filter((e) => ['created', 'status', 'triage', 'asked', 'answered', 'sent'].includes(e.kind))
      .map((e) => ({ id: e.id, kind: e.kind, actor: e.actor, at: e.created_at })),
    page_url: row.page_url,
  };
}

async function route(ctx: Ctx): Promise<Response> {
  const { request } = ctx;
  const env: TaskEnv = Object.assign(Object.create(ctx.env) as TaskEnv, { DEFER: ctx.waitUntil });
  const method = request.method.toUpperCase();
  const actor = actorOf(request, ctx.user);
  if (!actor) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  if (!(await intakeReady(env))) return errorJson('not_ready', 'Requests in Projects are not switched on yet.', 503);
  const [, a, b, c] = ctx.path;
  const url = new URL(request.url);

  if (a === 'mine' && !b && method === 'GET') return json({ ok: true, requests: await myItems(env, actor, url.searchParams.get('all') === '1') }, 200, noStore);

  if (a === 'parse' && !b && method === 'POST') {
    const text = String((await body(request)).text || '').slice(0, 4000);
    const { parsed, people } = await parseFor(env, text);
    return json({ ok: true, parsed, people }, 200, noStore);
  }

  if (a === 'submit' && !b && method === 'POST') {
    if (await hitRateLimit(env, `intake:${actor.email}`, 30, 3600)) return errorJson('rate_limited', 'Slow down a moment. You can send another request shortly.', 429);
    let input: Record<string, unknown>;
    const files: FileIn[] = [];
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData();
      try {
        input = asObject(JSON.parse(String(form.get('payload') || '{}')));
      } catch {
        throw new HttpError(400, 'bad_payload', 'The request could not be read.');
      }
      for (const [key, value] of form.entries()) {
        if ((key !== 'files' && key !== 'file') || typeof value === 'string') continue;
        const blob = value as File;
        files.push({ bytes: await blob.arrayBuffer(), filename: blob.name || 'upload.jpg', contentType: blob.type || 'application/octet-stream' });
      }
    } else input = await body(request);
    const r = await submitRequest(env, actor, input as never, files);
    if (r.expense) return json({ ok: false, error: 'expense', message: 'This is about money, so it goes on an expense request.', href: r.expense.href, parsed: r.parsed }, 409);
    const [item] = await buildItems(env, [r.request!.id]);
    return json({ ok: true, request: item, parsed: r.parsed }, 201);
  }

  if (a === 'teams' && !b && method === 'GET') return json({ ok: true, teams: await teamsOut(env, actor) }, 200, noStore);

  if (a === 'queue' && !b && method === 'GET') {
    const scope = (['intake', 'open', 'all'].includes(url.searchParams.get('scope') || '') ? url.searchParams.get('scope') : 'intake') as QueueScope;
    const r = await queueItems(env, actor, { team: url.searchParams.get('team') || undefined, scope });
    return json({ ok: true, teams: r.teams, requests: r.items }, 200, noStore);
  }

  if (a === 'r' && b && !c && method === 'GET') return json({ ok: true, ...(await requestDetail(env, actor, b)) }, 200, noStore);

  if (a === 'r' && b && c === 'options' && method === 'GET') {
    const { standing } = await readableRequest(env, actor, b);
    if (!standing.triage) throw new HttpError(403, 'forbidden', 'Only the owners of this team\'s requests and FavorOS admins can do that.');
    const [targets, people] = await Promise.all([acceptTargets(env, actor), staffDirectory(env).catch(() => [])]);
    return json({ ok: true, projects: targets, people: people.map((p) => ({ email: p.email, name: p.name, title: p.title, team: p.team, picture: p.picture })) }, 200, noStore);
  }

  if (a === 'r' && b && c && method === 'POST') {
    const input = await body(request);
    if (c === 'accept') return json({ ok: true, ...(await acceptCard(env, actor, b, input)) });
    if (c === 'ask') return json({ ok: true, request: await askQuestion(env, actor, b, input.question) });
    if (c === 'decline') return json({ ok: true, request: await declineCard(env, actor, b, input.reason) });
    if (c === 'reply') return json({ ok: true, request: await replyToRequest(env, actor, b, input.body) });
  }

  return errorJson('not_found', 'No such route.', 404);
}
