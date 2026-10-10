import { HttpError, nowIso } from '../../_lib/http';
import { listStaff } from '../../_lib/work/db';
import { mirrorQ } from '../../_lib/work/partner';
import { loadPortfolio, type PlannedTask } from '../../_lib/work/portfolio';
import { work } from '../../_lib/work/route';
import { todayEt } from '../../_lib/work/service';

// My partners: the partners a director holds, quiet ones first, with what they give. Read only, from the mirror, kept ten minutes.
// A director sees their own list. Support sees the directors they support; an admin sees any director.
const TEAMS = new Set(['rdd', 'church', 'exec']);

export const onRequestGet = work(async ({ ctx, env, url }) => {
  const s = ctx.scope;
  if (s && s.role !== 'admin' && s.role !== 'support' && s.role !== 'director') throw new HttpError(403, 'not_yours', 'My partners is for the regional directors, church engagement and the Support Team.');
  const staff = (await listStaff(env)).filter((x) => x.active === 1 && x.bb_fundraiser_id && TEAMS.has(x.team));
  const allowed = staff.filter((x) => !s || s.all || s.fids.has(String(x.bb_fundraiser_id)));
  const directors = allowed.map((x) => ({ fid: String(x.bb_fundraiser_id), name: x.name, email: x.email, team: x.team }));
  const want = (url.searchParams.get('owner') || '').replace(/\D/g, '');
  const mine = s && s.fid && directors.some((d) => d.fid === s.fid) ? s.fid : '';
  const owner = want || mine || (directors[0] ? directors[0].fid : '');
  if (!owner) return { directors, portfolio: null };
  if (!directors.some((d) => d.fid === owner)) throw new HttpError(403, 'not_yours', 'That portfolio is not one you can open.');
  const today = todayEt();
  const key = `pf:${owner}:${today}`;
  let base: any = null;
  if (url.searchParams.get('fresh') !== '1') {
    const hit = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(key).first<{ value: string; at: string }>().catch(() => null);
    if (hit && Date.now() - Date.parse(hit.at) < 10 * 60000) base = JSON.parse(hit.value);
  }
  if (!base) {
    base = await loadPortfolio(mirrorQ(env), owner, today);
    await env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
      .bind(key, JSON.stringify(base), nowIso())
      .run()
      .catch(() => {});
  }
  // Tasks the hub saved in the last three days and the mirror may not hold yet.
  const planned = await plannedTasks(env, base.rows.map((r: any) => r.cid));
  if (planned.length) {
    const by = new Map<string, PlannedTask>();
    for (const p of planned) if (!by.has(p.cid) || p.due < by.get(p.cid)!.due) by.set(p.cid, p);
    for (const r of base.rows) {
      const p = by.get(r.cid);
      if (p && (!r.next || !r.next.due || p.due < r.next.due) && (!r.next || r.next.id !== p.id)) r.next = { id: p.id, due: p.due, summary: p.summary, planned: true };
    }
  }
  return { directors, owner, portfolio: base, at: nowIso() };
});

async function plannedTasks(env: any, cids: string[]): Promise<PlannedTask[]> {
  if (!cids.length) return [];
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const r = await env.DB.prepare(
    `SELECT o.id AS oid, o.cid AS cid, o.bb_id AS bb, o.payload AS payload FROM act_outbox o JOIN act_batches b ON b.id = o.batch_id
      WHERE o.op = 'create' AND o.state IN ('queued', 'sent', 'verified') AND o.cid IS NOT NULL AND o.queued_at >= ? AND b.state <> 'undone' ORDER BY o.queued_at DESC LIMIT 600`
  )
    .bind(since)
    .all()
    .catch(() => ({ results: [] as any[] }));
  const set = new Set(cids);
  const out: PlannedTask[] = [];
  for (const row of r.results as any[]) {
    if (!set.has(String(row.cid))) continue;
    let p: any = {};
    try {
      p = JSON.parse(row.payload);
    } catch {
      continue;
    }
    if (p.completed === true || p.completed === 'true') continue;
    out.push({ cid: String(row.cid), id: String(row.bb || row.oid), due: String(p.date || '').slice(0, 10), summary: String(p.summary || '') });
  }
  return out;
}
