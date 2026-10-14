import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { snoozedKeys } from '../../_lib/hub/snooze';
import { awayFor, touchSeen, wasAway } from '../../_lib/brief/away';
import { buildBriefing, overnightGifts, workCtxFor, type Briefing } from '../../_lib/brief/briefing';
import { cacheAged, cachePut } from '../../_lib/brief/text';
import { todayEt } from '../../_lib/work/service';

// The morning briefing for Today, and "Since you were away" when the person has been off a day or more.
//   GET /api/brief/today?owner=<fundraiser id>&fresh=1
// Returns { ok, briefing, away }. Partner content (overnight gifts, thank-yous, moments) is built only for people the Work Center gate
// opens for; everyone else gets briefing.partners = false and the late-actions part alone. The page calls this once per visit, which also
// records the visit (db/briefing.sql) so the next visit knows where this one ended.
const FRESH_MS = 5 * 60_000;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (user.via !== 'google') return json({ ok: true, briefing: null, away: null });
    const url = new URL(request.url);
    const owner = (url.searchParams.get('owner') || '').replace(/\D/g, '');
    const today = todayEt();
    const email = user.email.toLowerCase();
    const seen = await touchSeen(env, email);
    const ctx = await workCtxFor(env, user);
    const key = `brief2:${email}:${owner}:${today}`;
    // Today's saved briefing answers at once, however old (the prewarm job builds one for each regular before 7 AM). Older than five
    // minutes, the answer says stale and the page asks again with fresh=1 behind the drawn card, which rebuilds and saves it.
    const hit = url.searchParams.get('fresh') === '1' ? null : await cacheAged<Briefing>(env, key);
    let briefing = hit ? hit.value : null;
    const stale = !!hit && hit.age > FRESH_MS;
    if (!briefing) {
      briefing = await buildBriefing({ env, user, ctx, ownerIn: owner, today });
      await cachePut(env, key, briefing);
    }
    const snoozed = await snoozedKeys(env, email);
    const out: Briefing = { ...briefing, moments: briefing.moments.filter((m) => !snoozed.has(`moment:${m.id}`)) };
    let away = null;
    if (wasAway(seen)) {
      let gifts = null;
      if (ctx && ctx.scope) {
        const s = ctx.scope;
        const fids = out.owner ? [out.owner] : s.all ? [] : [...s.fids];
        const since = new Date(Date.parse(seen.away_from)).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const g = await overnightGifts(env, fids, today, since).catch(() => null);
        if (g) gifts = { count: g.count, total: g.total };
      }
      away = await awayFor({ env, email, from: seen.away_from, gifts, isAdmin: user.role === 'admin' }).catch(() => null);
    }
    return json({ ok: true, briefing: out, away, stale });
  } catch (err) {
    return handleError(err);
  }
};
