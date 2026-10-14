import { kpiGet } from '../../_lib/hub/kpi';
import { accessOf, navCounts } from '../../_lib/hub/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { fieldBrainOn } from '../../_lib/field';
import { releaseMap } from '../../_lib/hub/release';

// The sidebar: who is signed in, which sections they may open, and the counts beside each.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    // Field staff see Chat, Meetings and Favor Brain, no counts and no dashboard tabs.
    if (user.role === 'field') return json({ ok: true, user, access: { field: true, chat: true, meetings: true, brain: await fieldBrainOn(env), admin: false, kpi: false }, counts: {}, kpiTeams: [], release: await releaseMap(env) });
    const access = await accessOf(env, request, user);
    // The KPI dashboard's own team map (kpi-dashboard backend/access.js) decides which of its tabs
    // show in the sidebar. A slow or failed answer leaves just the Executive page and Definitions.
    const [counts, kpiTeams] = await Promise.all([
      navCounts(env, user, access, request),
      user.via === 'google'
        ? kpiGet<{ teams?: string[] }>(env, '/auth/verify', { email: user.email, name: user.name })
            .then((v) => (Array.isArray(v.teams) ? v.teams : []))
            .catch(() => [] as string[])
        : Promise.resolve(['rdd', 'ce', 'pc', 'grants', 'marketing']),
    ]);
    // The first menu request after sign-in starts the saved inbox, so Mail opens warm.
    if (access.mail && user.via === 'google' && waitUntil) waitUntil(import('../../_lib/mail/route').then((m) => m.warmMail(env, user.email)).catch(() => undefined));
    return json({ ok: true, user, access, counts, kpiTeams, release: await releaseMap(env) });
  } catch (err) {
    return handleError(err);
  }
};
