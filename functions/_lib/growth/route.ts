// Growth routes: the first week for a role and practice mode. One router so tests call it with a stand-in database.
//   GET    first-week            my first week, from my onboarding run or my team and title
//   GET    practice              the practice partner, the two exercises and what I entered
//   POST   practice/gift         { date, amount, type, check, fund } -> the checks and the new state
//   POST   practice/call         { channel, summary, next, due }
//   DELETE practice              start over
// Practice never reaches Blackbaud: nothing in this folder imports the Work Center or the outbox.
import { HttpError, handleError, json, type Env } from '../http';
import type { HubUser } from '../session';
import { staffDirectory } from '../people';
import { reportingOf } from '../people-dev';
import { sameSite } from '../work/route';
import { firstWeekFor } from './firstweek';
import { practiceState, resetPractice, savePractice } from './practice';

export interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  path: string[];
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export async function profileOf(env: Env, email: string) {
  const me = email.toLowerCase();
  let run: { team: string; title: string; date: string } | null = null;
  try {
    run = await env.DB.prepare(`SELECT team, title, date FROM onb_runs WHERE email = ? AND kind = 'onboard' AND status <> 'cancelled' ORDER BY (status = 'active') DESC, date DESC LIMIT 1`).bind(me).first();
  } catch {
    run = null;
  }
  const rep = await reportingOf(env, me).catch(() => null);
  const dir = (await staffDirectory(env).catch(() => [])).find((p) => p.email === me);
  return {
    email: me,
    team: run?.team || rep?.department || dir?.team || '',
    title: run?.title || rep?.title || dir?.title || '',
    start: run?.date || rep?.startDate || '',
    hasRun: !!run,
  };
}

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    if (!ctx.user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
    const { request, env } = ctx;
    const [a, b] = ctx.path;
    const me = ctx.user.email;
    const m = request.method;
    if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That change did not come from FavorOS. Reload the page and try again.');
    if (a === 'first-week' && m === 'GET') {
      const p = await profileOf(env, me);
      return json({ ok: true, ...(await firstWeekFor(env, p)), hasRun: p.hasRun });
    }
    if (a === 'practice') {
      if (!b && m === 'GET') return json({ ok: true, ...(await practiceState(env, me)) });
      if (!b && m === 'DELETE') return json({ ok: true, ...(await resetPractice(env, me)) });
      if ((b === 'gift' || b === 'call') && m === 'POST') return json({ ok: true, ...(await savePractice(env, me, b, await body(request))) });
    }
    throw new HttpError(404, 'not_found', 'There is nothing at that address.');
  } catch (err) {
    return handleError(err);
  }
}
