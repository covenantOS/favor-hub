import { nowIso } from '../../_lib/http';
import { bookFor, nbaOf, readBook } from '../../_lib/brief/facts';
import { HEALTH_LABEL } from '../../_lib/brief/signals';
import { cacheGet, cachePut } from '../../_lib/brief/text';
import { mirrorQ } from '../../_lib/work/partner';
import { work } from '../../_lib/work/route';
import { giftsResponse, mayGifts } from '../../_lib/work/gifts-svc';
import { todayEt } from '../../_lib/work/service';

// Portfolio health: every partner a director holds, with how their giving is moving (growing, steady, slipping, lapsing, at risk, new),
// the reason in one sentence and the next best action. Same partners and the same owner rules as My partners (/api/work/portfolio).
//   GET /api/brief/book?owner=<fundraiser id>&fresh=1
//   -> { ok, owner, directors, today, counts: { health: n }, rows: [{ cid, health, why, cadence, expectedNext, lateDays, nba: { kind, label, why, channel, urgency } }] }
export const onRequestGet = work(async ({ ctx, env, url }) => {
  const today = todayEt();
  const book = await bookFor(ctx, url.searchParams.get('owner') || '', today);
  if (!book.portfolio) return { owner: '', directors: book.directors, today, counts: {}, rows: [], labels: HEALTH_LABEL };
  const key = `bk:${book.owner}:${today}`;
  let rows = url.searchParams.get('fresh') === '1' ? null : await cacheGet<any[]>(env, key, 10 * 60000);
  if (!rows) {
    const reads = await readBook(mirrorQ(env), book.portfolio.rows, today);
    // Gifts waiting for a thank-you, by partner, so the next step puts thanking first.
    const owed = new Map<string, { n: number; total: number; oldestDays: number }>();
    if (mayGifts(ctx.scope)) {
      const g = await giftsResponse(ctx, book.owner).catch(() => null);
      for (const r of g ? g.rows : []) {
        const o = owed.get(r.cid) || { n: 0, total: 0, oldestDays: 0 };
        o.n++;
        o.total += r.amount;
        o.oldestDays = Math.max(o.oldestDays, r.ageDays);
        owed.set(r.cid, o);
      }
    }
    rows = reads.map((p) => ({ cid: p.cid, health: p.health, why: p.why, cadence: p.rhythm.cadence, expectedNext: p.rhythm.expectedNext, lateDays: p.rhythm.lateDays, nba: nbaOf(p, today, owed.get(p.cid) || null) }));
    await cachePut(env, key, rows);
  }
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.health] = (counts[r.health] || 0) + 1;
  return { owner: book.owner, directors: book.directors, today, counts, rows, labels: HEALTH_LABEL, at: nowIso() };
});
