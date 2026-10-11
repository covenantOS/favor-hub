import { accessOf, activityFor, mineFor, waitingCards } from '../../_lib/hub/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { snoozedKeys } from '../../_lib/hub/snooze';

// The Today page: what is waiting on this person, their own requests, and recent activity.
// The year's numbers come separately from /api/hub/kpi, so this page never waits on the KPI dashboard.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const access = await accessOf(env, request, user);
    const [all, mine, activity, snoozed] = await Promise.all([waitingCards(env, user, access), mineFor(env, user), activityFor(env, access), snoozedKeys(env, user.email)]);
    // Snoozed cards stay off Today until their day.
    const cards = all.filter((c) => !snoozed.has(`card:${c.id}`));
    return json({ ok: true, user, access, cards, mine, activity });
  } catch (err) {
    return handleError(err);
  }
};
