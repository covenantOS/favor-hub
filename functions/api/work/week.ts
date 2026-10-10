import { HttpError, nowIso } from '../../_lib/http';
import { listStaff } from '../../_lib/work/db';
import { mirrorQ } from '../../_lib/work/partner';
import { loadPortfolio, type PortfolioRow } from '../../_lib/work/portfolio';
import { work } from '../../_lib/work/route';
import { todayEt } from '../../_lib/work/service';
import { loadWeek, WEEK_TEAMS } from '../../_lib/work/week';

// My week: the weekly goals, what counted, the giving line and the data behind the report draft. Read only, from the D1 copy of
// Blackbaud, kept five minutes. A director sees their own week. Support sees the directors they support; an admin sees any director.
const TTL = 5 * 60000;

export const onRequestGet = work(async ({ ctx, env, url }) => {
  const s = ctx.scope;
  if (s && s.role !== 'admin' && s.role !== 'support' && s.role !== 'director') throw new HttpError(403, 'not_yours', 'My week is for the regional directors and the Support Team.');
  const staff = (await listStaff(env)).filter((x) => x.active === 1 && x.bb_fundraiser_id && WEEK_TEAMS.has(x.team));
  const allowed = staff.filter((x) => !s || s.all || s.fids.has(String(x.bb_fundraiser_id)));
  const directors = allowed.map((x) => ({ fid: String(x.bb_fundraiser_id), name: x.name, email: x.email }));
  const want = (url.searchParams.get('owner') || '').replace(/\D/g, '');
  const mine = s && s.fid && directors.some((d) => d.fid === s.fid) ? s.fid : '';
  const owner = want || mine || (directors[0] ? directors[0].fid : '');
  if (!owner) return { directors, owner: '', week: null };
  if (!directors.some((d) => d.fid === owner)) throw new HttpError(403, 'not_yours', 'That week is not one you can open.');
  const back = url.searchParams.get('week') === 'last' ? 1 : 0;
  const today = todayEt();
  const key = `wk:${owner}:${today}:${back}`;
  let data: any = null;
  if (url.searchParams.get('fresh') !== '1') {
    const hit = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(key).first<{ value: string; at: string }>().catch(() => null);
    if (hit && Date.now() - Date.parse(hit.at) < TTL) data = JSON.parse(hit.value);
  }
  if (!data) {
    const q = mirrorQ(env);
    data = await loadWeek(q, owner, today, back, { portfolio: () => portfolioRows(env, q, owner, today) });
    await env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
      .bind(key, JSON.stringify(data), nowIso())
      .run()
      .catch(() => {});
  }
  const dir = directors.find((d) => d.fid === owner);
  return { directors, owner, ownerName: dir ? dir.name : data.name, week: data, at: nowIso() };
});

// The partners the director holds, from the copy My partners keeps for ten minutes, else read fresh.
async function portfolioRows(env: any, q: ReturnType<typeof mirrorQ>, owner: string, today: string): Promise<PortfolioRow[]> {
  const key = `pf:${owner}:${today}`;
  const hit = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(key).first().catch(() => null);
  if (hit && Date.now() - Date.parse(hit.at) < 10 * 60000) {
    try {
      return JSON.parse(hit.value).rows as PortfolioRow[];
    } catch {
      /* read fresh */
    }
  }
  return (await loadPortfolio(q, owner, today)).rows;
}
