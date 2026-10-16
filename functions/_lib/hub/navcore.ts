// Reads this person's menu flags for the page head (see navboot.ts). Split from it so the cookie and script helpers load without the database code.
import { kpiGet } from './kpi';
import { accessOf } from './today';
import { jobsOf } from './jobs';
import { readBoot, type NavBoot } from './navboot';
import type { HubUser } from '../session';
import type { Env } from '../http';

/** The three answers the menu's access flags come from. /api/hub/nav and the page head both call this, so they cannot disagree. */
export async function navCore(env: Env, request: Request, user: HubUser): Promise<{ access: Awaited<ReturnType<typeof accessOf>>; kpiTeams: string[]; jobs: string[] }> {
  const access = await accessOf(env, request, user);
  const [kpiTeams, jobs] = await Promise.all([
    user.via === 'google'
      ? kpiGet<{ teams?: string[] }>(env, '/auth/verify', { email: user.email, name: user.name })
          .then((v) => (Array.isArray(v.teams) ? v.teams : []))
          .catch(() => [] as string[])
      : Promise.resolve(['rdd', 'ce', 'pc', 'grants', 'marketing']),
    // Whose work this person does: which areas sit in their rail and which tabs come first. Never a gate.
    jobsOf(env, user.email, { admin: access.admin, giftEntry: access.giftEntry, hr: access.hr, approver: access.approver }).catch(() => [] as string[]),
  ]);
  return { access, kpiTeams, jobs };
}

/** Boot data for a page load: the cookie when it is fresh, else one lookup that runs beside the page (never longer than the cap). */
export function bootFor(env: Env, request: Request, user: HubUser, capMs = 1500): Promise<{ boot: NavBoot; fresh: boolean } | null> {
  if (user.role === 'field' || user.via === 'agent') return Promise.resolve(null);
  const saved = readBoot(request, user);
  if (saved) return Promise.resolve({ boot: saved, fresh: false });
  const look = navCore(env, request, user).then((c) => ({ boot: { user, access: c.access, kpiTeams: c.kpiTeams, jobs: c.jobs }, fresh: true }));
  const cap = new Promise<null>((r) => setTimeout(() => r(null), capMs));
  return Promise.race([look, cap]).catch(() => null);
}

