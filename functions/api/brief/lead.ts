import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import type { Briefing } from '../../_lib/brief/briefing';
import { cacheGet, cachePut, HOUSE, sig, writeText } from '../../_lib/brief/text';
import { todayEt } from '../../_lib/work/service';

// The two or three sentences at the top of the briefing. Written from the briefing /api/brief/today just saved, so it never
// contradicts the lines under it, and kept per person and day until those facts change.
//   GET /api/brief/lead?owner=<fundraiser id>   ->   { ok, text }   (text is null when there is nothing to say)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const owner = (new URL(request.url).searchParams.get('owner') || '').replace(/\D/g, '');
    const email = user.email.toLowerCase();
    const today = todayEt();
    const b = await cacheGet<Briefing>(env, `brief:${email}:${owner}:${today}`, 30 * 60000);
    if (!b) return json({ ok: true, text: null });
    const facts = {
      first: (user.name || '').split(/\s+/)[0],
      newGifts: b.overnight ? { count: b.overnight.count, total: b.overnight.total, top: b.overnight.rows.slice(0, 3).map((g) => ({ partner: g.name, amount: g.amount, fund: g.fund })) } : null,
      toThank: b.thanks ? { total: b.thanks.total, waitingOverADay: b.thanks.over24, oldest: b.thanks.rows[0] ? { partner: b.thanks.rows[0].name, days: b.thanks.rows[0].ageDays } : null } : null,
      lateActions: b.late ? b.late.count : 0,
      moments: b.moments.slice(0, 3).map((m) => `${m.name}: ${m.line}`),
    };
    const key = `lead:${email}:${owner}:${today}`;
    const s = sig(facts);
    const hit = await cacheGet<{ sig: string; text: string }>(env, key, 6 * 3600000);
    if (hit && hit.sig === s) return json({ ok: true, text: hit.text });
    if (!facts.newGifts?.count && !facts.toThank?.total && !facts.lateActions && !facts.moments.length) return json({ ok: true, text: null });
    const text = await writeText(env, {
      system: `${HOUSE} Write the opening of a morning briefing: two or three sentences that speak to the person as "you". Lead with what needs them most today (thank-yous waiting, late actions), then what came in. Name at most two partners.`,
      user: JSON.stringify(facts),
      max: 130,
      timeoutMs: 9000,
    });
    if (text) await cachePut(env, key, { sig: s, text });
    return json({ ok: true, text });
  } catch (err) {
    return handleError(err);
  }
};
