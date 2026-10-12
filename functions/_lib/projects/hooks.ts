// What other parts of the hub hang on a task change: the Chat card, Google Calendar, the designed emails, search.
// Every write in lane CORE calls fire() once with what happened. A hook that throws never undoes the change.
// Kinds: project.created, project.updated, task.created, task.updated, task.done, task.reopened, task.moved, task.deleted,
//   task.assigned, task.comment, task.mention, task.file, task.people, task.deps, task.waiting.
import type { Env } from '../http';
import type { ProjectRow, TaskRow } from './db';

export interface ProjectEvent {
  kind: string;
  actor: string;
  actorName?: string;
  task?: TaskRow | null;
  project?: ProjectRow | null;
  /** What changed: { fields: [...], from: {...}, to: {...} } for an update, { comment } for a comment, and so on. */
  detail?: Record<string, unknown>;
  /** Emails that were sent a notice for this change (the gate already decided). */
  told?: string[];
}

export type ProjectHook = (env: Env, ev: ProjectEvent) => Promise<void> | void;

const hooks: ProjectHook[] = [];

export function onProjectEvent(h: ProjectHook): void {
  hooks.push(h);
}

export async function fire(env: Env, ev: ProjectEvent, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  if (!hooks.length) return;
  const run = (async () => {
    for (const h of hooks) {
      try {
        await h(env, ev);
      } catch (err) {
        console.error('[projects] hook', ev.kind, err);
      }
    }
  })();
  if (waitUntil) waitUntil(run);
  else await run;
}

export interface RouteCtx {
  request: Request;
  env: Env;
  user: import('../session').HubUser | null;
  /** The path after /api/tasks/ or /api/projects/, e.g. ['brain']. */
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const routes = new Map<string, (ctx: RouteCtx) => Promise<Response>>();

/** A route another lane owns under /api/tasks/<name> (for example brain). It runs before the sign-in and mode checks and does its own. */
export function registerTaskRoute(name: string, h: (ctx: RouteCtx) => Promise<Response>): void {
  routes.set(name, h);
}

export function taskRoute(name: string): ((ctx: RouteCtx) => Promise<Response>) | undefined {
  return routes.get(name);
}

// LINKS: register your hooks and routes below with onProjectEvent(...). Keep the lines between the markers; nothing else in this file changes.
// --- links begin
import { agentDoor, linksRoute, registerLinks } from './links/index';
registerLinks(onProjectEvent);
registerTaskRoute('links', linksRoute);
registerTaskRoute('brain', (ctx) => agentDoor(ctx.env, ctx.request));
// --- links end
