import { work } from '../../_lib/work/route';
import { cadenceRows } from '../../_lib/work/cadence-svc';
import { asksAge, mirrorAsks, KV_TTL_S } from '../../_lib/work/asks';
import { listMirrorQ } from '../../_lib/work/partner';
import { todayEt } from '../../_lib/work/service';
import { etParts } from '../../_lib/actions/intake';
import { buildBriefing, workCtxFor } from '../../_lib/brief/briefing';
import { cachePut } from '../../_lib/brief/text';
import type { HubUser } from '../../_lib/session';

// The prewarm pass, called every five minutes by favor-work-drain (agent key). From 5 AM to 9 PM Eastern it keeps the Work Center's
// two slow reads current: the cadence rows (rebuilt when the mirror has synced since) and the asks' mirror read (re-read when the saved
// copy is five minutes old). From 5 to 7 AM it also builds today's briefing for everyone who opened FavorOS in the last two weeks, a few
// people per call, so the first Today of the morning reads a saved copy instead of waiting 7 to 12 seconds.
const BUDGET_MS = 20_000;

export const onRequestPost = work(
  async ({ ctx }) => {
    const t0 = Date.now();
    const hour = etParts(new Date()).hour;
    if (hour < 5 || hour >= 21) return { ok: true, why: 'night' };
    const today = todayEt();
    const out: Record<string, unknown> = { ok: true };

    const c0 = Date.now();
    const built = await cadenceRows(ctx, today);
    out.cadence = { rows: built.rows.length, ms: Date.now() - c0 };

    const kv = (ctx.env as unknown as { BB_KV?: Parameters<typeof asksAge>[0] }).BB_KV;
    const age = await asksAge(kv, today);
    if (age >= (KV_TTL_S - 30) * 1000) {
      const a0 = Date.now();
      const m = await mirrorAsks(listMirrorQ(ctx.env), today, false, kv, undefined, true);
      out.asks = { rows: m.asks.length, ms: Date.now() - a0 };
    } else out.asks = { age: Math.round(age / 1000) };

    if (hour < 7) {
      const since = new Date(Date.now() - 14 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const people = await ctx.env.DB.prepare(
        `SELECT u.email, u.name, u.role FROM hub_users u
          WHERE u.blocked = 0 AND u.role IN ('admin', 'staff') AND u.email NOT LIKE 'tester%'
            AND EXISTS (SELECT 1 FROM hub_usage g WHERE g.email = u.email AND g.day >= ?1)
            AND NOT EXISTS (SELECT 1 FROM act_cache k WHERE k.key = 'brief2:' || lower(u.email) || '::' || ?2)
          ORDER BY u.email`
      ).bind(since, today).all<{ email: string; name: string; role: string }>();
      const list = people.results || [];
      let made = 0;
      const failed: string[] = [];
      for (const p of list) {
        if (Date.now() - t0 > BUDGET_MS) break;
        const user: HubUser = { email: p.email, name: p.name || p.email, picture: '', role: p.role as HubUser['role'], via: 'google', kpi: true };
        try {
          const wctx = await workCtxFor(ctx.env, user);
          const briefing = await buildBriefing({ env: ctx.env, user, ctx: wctx, ownerIn: '', today });
          await cachePut(ctx.env, `brief2:${p.email.toLowerCase()}::${today}`, briefing);
          made++;
        } catch (err) {
          failed.push(`${p.email}: ${String((err as Error)?.message || err).slice(0, 80)}`);
        }
      }
      out.briefings = { made, left: list.length - made - failed.length, failed };
    }
    out.ms = Date.now() - t0;
    return out;
  },
  { adminOnly: true }
);
