// The onboarding routes, one router so tests can call it with a stand-in database. Under /api/onboarding:
//   GET    (nothing)                    the runs I may see, the owners, the duties, who I am to this page
//   POST   runs                         start a run (HR and hub admins)
//   GET    runs/:id                     one run with its steps, the HR file marks, people and history
//   PATCH  runs/:id                     { welcome?, supervisor_email?, title?, team?, status: 'cancelled' }
//   POST   runs/:id/steps               add a step to this run
//   PATCH  runs/:id/steps/:sid          { status?, owner_email?, due_date?, note?, title?, detail? }
//   PUT    runs/:id/docs/:key           { got }  a document in the HR file was received
//   POST   runs/:id/hub                 { action: 'add' | 'close', confirm: true, emailWelcome? }   FavorOS does its own steps
//   GET    runs/:id/owned               what a leaving person still owns
//   POST   runs/:id/handover            { to, tasks?, requests?, reports? }
//   GET    owners   PUT owners          { duty, email }
//   GET    template?kind=   PUT template { kind, ...step }   POST template/reset { kind }
//   GET    welcome                      the first-day page for the signed-in person
import { HttpError, errorJson, handleError, json, type Env } from '../http';
import { hubUserOf, isAdminEmail, type HubUser } from '../session';
import { sameSite } from '../work/route';
import { actorOf } from '../requests/tasks';
import { DUTIES, GROUPS, RUN_DUTIES, type Kind } from './template';
import { addStep, editRun, editStep, editTemplate, handOver, hubAdd, hubClose, listRuns, mayManage, onboardingReady, ownedBy, ownersMap, resetTemplate, runDetail, setDoc, setOwner, startRun, templateFor, type Actor } from './run';
import { welcomeFor } from './welcome';
import { staffDirectory } from '../people';

export interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const body = async (request: Request): Promise<Record<string, any>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {};
};

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    return await route(ctx);
  } catch (err) {
    return handleError(err);
  }
}

const kindOf = (v: unknown): Kind => (v === 'offboard' ? 'offboard' : 'onboard');

async function route(ctx: Ctx): Promise<Response> {
  const { request, env, path } = ctx;
  const method = request.method.toUpperCase();
  const actor = actorOf(request, ctx.user) as Actor | null;
  if (!actor) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That change did not come from FavorOS. Reload the page and try again.');
  const [a, b, c, d] = path;

  if (a === 'welcome' && !b && method === 'GET') {
    if (!(await onboardingReady(env))) return json({ ok: true, ready: false, me: { email: actor.email, name: actor.name, picture: '' }, run: null, steps: [], meet: [], week: [], learn: {} });
    return json({ ok: true, ready: true, ...(await welcomeFor(env, actor)) });
  }

  if (!(await onboardingReady(env))) return errorJson('not_ready', 'Onboarding is not switched on yet.', 503);
  const manage = await mayManage(env, actor);

  if (!a && method === 'GET') {
    const status = new URL(request.url).searchParams.get('status');
    const runs = await listRuns(env, actor, status === 'done' ? 'done' : status === 'all' ? 'all' : 'active');
    return json({ ok: true, can: { manage }, me: actor.email, runs, owners: await ownersMap(env), duties: DUTIES, groups: GROUPS });
  }

  if (a === 'people' && method === 'GET') return json({ ok: true, me: actor.email, people: await staffDirectory(env) });

  if (a === 'owners') {
    if (method === 'GET') return json({ ok: true, owners: await ownersMap(env), duties: DUTIES, can: { manage } });
    if (method === 'PUT') {
      if (!manage) throw new HttpError(403, 'forbidden', 'Owners are set by FavorOS admins and HR.');
      const input = await body(request);
      await setOwner(env, actor, String(input.duty || ''), String(input.email || ''));
      return json({ ok: true, owners: await ownersMap(env) });
    }
  }

  if (a === 'template') {
    if (!manage) throw new HttpError(403, 'forbidden', 'The checklist is edited by FavorOS admins and HR.');
    if (method === 'GET') {
      const kind = kindOf(new URL(request.url).searchParams.get('kind'));
      return json({ ok: true, kind, steps: await templateFor(env, kind, true), groups: GROUPS[kind], duties: [...DUTIES, ...RUN_DUTIES.map((k) => ({ key: k, label: ({ supervisor: 'The supervisor', hire: 'The new hire', starter: 'Whoever starts the run' } as Record<string, string>)[k], hint: '' }))] });
    }
    if (method === 'PUT') {
      const input = await body(request);
      const kind = kindOf(input.kind);
      await editTemplate(env, actor, kind, input);
      return json({ ok: true, steps: await templateFor(env, kind, true) });
    }
    if (method === 'POST' && b === 'reset') {
      const kind = kindOf((await body(request)).kind);
      await resetTemplate(env, kind);
      return json({ ok: true, steps: await templateFor(env, kind, true) });
    }
  }

  if (a === 'runs') {
    if (!b && method === 'POST') {
      const made = await startRun(env, actor, await body(request));
      return json({ ok: true, ...made }, 201);
    }
    if (b && !c) {
      if (method === 'GET') return json({ ok: true, ...(await runDetail(env, actor, b)) });
      if (method === 'PATCH') {
        await editRun(env, actor, b, await body(request));
        return json({ ok: true, ...(await runDetail(env, actor, b)) });
      }
    }
    if (b && c === 'steps') {
      if (!d && method === 'POST') {
        await addStep(env, actor, b, await body(request));
        return json({ ok: true, ...(await runDetail(env, actor, b)) });
      }
      if (d && method === 'PATCH') {
        await editStep(env, actor, b, d, await body(request));
        // The new hire marks their own step from the first-day page and gets no run detail back.
        return json({ ok: true, ...(await runDetail(env, actor, b).catch((err) => (err instanceof HttpError && err.status === 403 ? {} : Promise.reject(err)))) });
      }
    }
    if (b && c === 'docs' && d && method === 'PUT') {
      await setDoc(env, actor, b, d, (await body(request)).got !== false);
      return json({ ok: true, ...(await runDetail(env, actor, b)) });
    }
    if (b && c === 'hub' && method === 'POST') {
      const input = await body(request);
      if (input.confirm !== true) throw new HttpError(400, 'confirm', 'Confirm before FavorOS makes this change.');
      const result = input.action === 'close' ? await hubClose(env, actor, b, (e) => isAdminEmail(env, e)) : await hubAdd(env, actor, b, { emailWelcome: input.emailWelcome !== false });
      return json({ ok: true, result, ...(await runDetail(env, actor, b)) });
    }
    if (b && c === 'owned' && method === 'GET') return json({ ok: true, owned: await ownedBy(env, actor, b) });
    if (b && c === 'handover' && method === 'POST') {
      const input = await body(request);
      const moved = await handOver(env, actor, b, input.to, { tasks: input.tasks, requests: input.requests, reports: input.reports });
      return json({ ok: true, moved, owned: await ownedBy(env, actor, b), ...(await runDetail(env, actor, b)) });
    }
  }
  return errorJson('not_found', 'No such route.', 404);
}

export function userOf(request: Request): HubUser | null {
  return hubUserOf(request);
}
