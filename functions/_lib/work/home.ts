// The Work Overview page's one read: everything the signed-in person needs on the Work home, cut to their role, in a single answer.
// Each part reads from the hub's own tables or the D1 copy of Blackbaud, so the page costs no Blackbaud calls. A part that fails
// comes back null and the page leaves that card out, so one slow source never blanks the page.
import { dayDiff, isLive, type BoardRow } from '../actions/board';
import type { Env } from '../http';
import { cadenceResponse, mayCadence } from './cadence-svc';
import { listStaff } from './db';
import { giftsResponse, mayGifts } from './gifts-svc';
import { weekStart } from './gifts';
import { mirrorQ } from './partner';
import { loadPortfolio, type PortfolioRow } from './portfolio';
import { can, type Scope } from './role';
import { currentBoard, recentBatches, todayEt, type Ctx } from './service';
import { loadWeek, GOALS, WEEK_TEAMS } from './week';
import { nowIso } from '../http';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);

export interface DueRow {
  id: string;
  cid: string;
  partner: string;
  place: string;
  due: string;
  late: number;
  type: string;
  summary: string;
}

async function dueBlock(ctx: Ctx, board: Awaited<ReturnType<typeof currentBoard>>) {
  const s = ctx.scope;
  const live = board.rows.filter((r) => !r.pending && !r.deceased && !r.ty);
  const fid = s && s.fid ? s.fid : '';
  const own = fid ? live.filter((r) => r.fundraisers.includes(fid)) : [];
  // Support, Partner Care and admins who hold no actions of their own open on the portfolio they work from.
  const portfolio = !own.length;
  const pool = portfolio ? live : own;
  const due = pool.filter((r) => r.due && dayDiff(r.due, board.today) <= 0).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const row = (r: BoardRow): DueRow => ({ id: r.id, cid: r.cid, partner: r.partner, place: r.place, due: r.due, late: Math.max(0, -dayDiff(r.due, board.today)), type: r.type, summary: clip(r.summary || '', 90) });
  return {
    scope: portfolio ? 'portfolio' : 'mine',
    open: pool.length,
    total: due.length,
    overdue: due.filter((r) => dayDiff(r.due, board.today) < 0).length,
    today: due.filter((r) => dayDiff(r.due, board.today) === 0).length,
    rows: due.slice(0, 8).map(row),
  };
}

async function giftsBlock(ctx: Ctx) {
  if (!mayGifts(ctx.scope)) return null;
  const g = await giftsResponse(ctx, '');
  const rows = [...g.rows]
    .filter((r) => !r.left)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount))
    .slice(0, 5)
    .map((r) => ({
      giftId: r.giftId, cid: r.cid, name: r.partner.name, place: r.partner.place, amount: r.amount, date: r.date, age: r.ageDays, fund: r.fund,
      phone: r.partner.doNotCall ? null : r.partner.phone, team: r.team, tasks: r.taskIds.length, badges: r.badges.slice(0, 2), owner: r.ownerNames[0] || '',
    }));
  return { total: g.stats.owed, over24: g.stats.over24, first: g.stats.first, week: g.stats.week, rows };
}

async function entryBlock(ctx: Ctx) {
  const s = ctx.scope;
  if (!can(s, 'entry')) return null;
  const staff = (await listStaff(ctx.env)).filter((x) => x.active === 1 && x.entry_owner === 1 && x.bb_fundraiser_id && (!s || s.all || s.fids.has(String(x.bb_fundraiser_id))));
  if (!staff.length) return { owners: [], wait: 0, late: 0 };
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const wk = weekStart(todayEt());
  const rs = await ctx.env.DB.prepare(
    `SELECT owner_fid AS fid, COUNT(*) AS n, SUM(CASE WHEN contact_date < ?2 THEN 1 ELSE 0 END) AS late FROM act_submissions
      WHERE contact_date >= ?1 AND state IN ('waiting', 'failed', 'posting') GROUP BY owner_fid`
  ).bind(since, wk).all<{ fid: string; n: number; late: number }>();
  const by = new Map(rs.results.map((r) => [String(r.fid), r]));
  const owners = staff
    .map((x) => ({ fid: String(x.bb_fundraiser_id), name: x.name, wait: Number(by.get(String(x.bb_fundraiser_id))?.n) || 0, late: Number(by.get(String(x.bb_fundraiser_id))?.late) || 0 }))
    .sort((a, b) => b.wait - a.wait || a.name.localeCompare(b.name));
  return { owners, wait: owners.reduce((n, o) => n + o.wait, 0), late: owners.reduce((n, o) => n + o.late, 0) };
}

/** Changes saved but not yet sent to Blackbaud (held for tonight, or still going). */
async function waitingBatches(env: Env, email?: string): Promise<number> {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const r = email
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM act_batches WHERE created_at >= ? AND state IN ('queued', 'running') AND op <> 'undo' AND lower(actor_email) = ?").bind(since, email.toLowerCase()).first<{ n: number }>()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM act_batches WHERE created_at >= ? AND state IN ('queued', 'running') AND op <> 'undo'").bind(since).first<{ n: number }>();
  return Number(r?.n) || 0;
}

async function directorWeek(ctx: Ctx, fid: string) {
  const today = todayEt();
  const q = mirrorQ(ctx.env);
  const pf = async (): Promise<PortfolioRow[]> => (await loadPortfolio(q, fid, today)).rows;
  const w = await loadWeek(q, fid, today, 0, { portfolio: pf });
  return {
    fid,
    range: w.week.range,
    goals: GOALS,
    counts: w.counts,
    giving: w.giving,
    asks: w.asks.length,
    next: w.next.length,
    quiet: w.quiet,
  };
}

async function weekBlock(ctx: Ctx) {
  const s = ctx.scope;
  if (!s) return null;
  if (s.role === 'director' && s.fid) {
    const staff = await listStaff(ctx.env);
    const me = staff.find((x) => String(x.bb_fundraiser_id || '') === s.fid);
    if (me && WEEK_TEAMS.has(me.team)) return { kind: 'director', ...(await directorWeek(ctx, s.fid)) };
    return { kind: 'director_plain' };
  }
  if (s.role === 'support') {
    const [entry, sending] = await Promise.all([entryBlock(ctx).catch(() => null), waitingBatches(ctx.env, s.all ? undefined : ctx.email).catch(() => 0)]);
    return { kind: 'support', entry, sending };
  }
  if (s.role === 'partner_care' && mayCadence(s)) {
    const c = await cadenceResponse(ctx, s.fid || '');
    return { kind: 'pc', stats: c.stats, owner: c.owner, everyone: c.everyone, unreachable: c.unreachable, lists: { friday: c.lists.friday.length, saturday: c.lists.saturday.length, sunday: c.lists.sunday.length } };
  }
  if (s.role === 'admin') {
    const [entry, sending] = await Promise.all([entryBlock(ctx).catch(() => null), waitingBatches(ctx.env).catch(() => 0)]);
    return { kind: 'admin', entry, sending };
  }
  return { kind: 'plain' };
}

function teamBlock(ctx: Ctx, board: Awaited<ReturnType<typeof currentBoard>>) {
  if (!ctx.scope || ctx.scope.role !== 'admin') return null;
  const by = new Map<string, { fid: string; name: string; team: string; open: number; overdue: number; ty: number }>();
  for (const r of board.rows) {
    if (r.pending) continue;
    for (const f of r.fundraisers) {
      const p = board.people[f];
      if (!p || !isLive(board.people, f)) continue;
      const e = by.get(f) || by.set(f, { fid: f, name: p.n, team: p.team, open: 0, overdue: 0, ty: 0 }).get(f)!;
      e.open++;
      if (r.due && dayDiff(r.due, board.today) < 0) e.overdue++;
      if (r.ty) e.ty++;
    }
  }
  const people = [...by.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open).slice(0, 14);
  return { people, total: by.size };
}

async function recentBlock(ctx: Ctx) {
  const s = ctx.scope;
  // A person sees their own changes. A team lead sees the team's: Support the directors', an admin everyone's.
  const all = await recentBatches(ctx.env, 24 * 7, s && !s.all && s.role !== 'support' ? ctx.email : undefined);
  return all
    .filter((b) => !b.undone)
    .slice(0, 8)
    .map((b) => ({ id: b.id, label: b.label, actor: b.actor, at: b.at, n: b.n, posted: b.posted, failed: b.failed, queued: b.queued }));
}

/** Every Work Center part of the page. Any part that fails is null. */
export async function workHome(ctx: Ctx) {
  const boardP = currentBoard(ctx);
  const [board, due, gifts, week, recent] = await Promise.all([
    boardP,
    boardP.then((b) => dueBlock(ctx, b)).catch(() => null),
    giftsBlock(ctx).catch(() => null),
    weekBlock(ctx).catch(() => null),
    recentBlock(ctx).catch(() => null),
  ]);
  const s: Scope | undefined = ctx.scope;
  return {
    today: board.today,
    synced: board.synced,
    role: s ? s.role : 'admin',
    fid: s && s.fid ? s.fid : null,
    due,
    gifts,
    week,
    team: teamBlock(ctx, board),
    recent,
    at: nowIso(),
  };
}

export type { Env };
