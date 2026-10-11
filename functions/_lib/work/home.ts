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

/** The actions the Work Overview's due card counts: the person's own, or the portfolio when they hold none. One place, so the card and its rows never differ. */
function duePool(ctx: Ctx, board: Awaited<ReturnType<typeof currentBoard>>) {
  const s = ctx.scope;
  const fid = s && s.fid ? s.fid : '';
  // Every count here is a count of open actions on the Work Center board, the same rows its Open actions tab counts, so each number
  // equals what its link opens. Someone who holds actions of their own sees those (the link adds their fundraiser id). Support,
  // Partner Care and admins who hold none see every open action in their scope.
  const own = fid ? board.rows.filter((r) => r.fundraisers.includes(fid)) : [];
  const portfolio = !own.length;
  const pool = portfolio ? board.rows : own;
  const dueAll = pool.filter((r) => r.due && dayDiff(r.due, board.today) <= 0);
  // The short list leaves out thank-you tasks (Gifts to thank lists those), pending changes and deceased partners.
  const due = dueAll.filter((r) => !r.pending && !r.deceased && !r.ty).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const row = (r: BoardRow): DueRow => ({ id: r.id, cid: r.cid, partner: r.partner, place: r.place, due: r.due, late: Math.max(0, -dayDiff(r.due, board.today)), type: r.type, summary: clip(r.summary || '', 90) });
  return { portfolio, fid, pool, dueAll, due, row, today: board.today };
}

async function dueBlock(ctx: Ctx, board: Awaited<ReturnType<typeof currentBoard>>) {
  const { portfolio, fid, pool, dueAll, due, row } = duePool(ctx, board);
  return {
    scope: portfolio ? 'portfolio' : 'mine',
    fr: portfolio ? '' : fid,
    open: pool.length,
    total: dueAll.length,
    overdue: dueAll.filter((r) => dayDiff(r.due, board.today) < 0).length,
    today: dueAll.filter((r) => dayDiff(r.due, board.today) === 0).length,
    rows: due.slice(0, 8).map(row),
  };
}

export const HOME_DRILLS = ['open', 'overdue', 'today', 'gifts', 'over24', 'first'] as const;
export type HomeDrill = (typeof HOME_DRILLS)[number];

/** The rows behind one Work Overview count, from the same pool and the same tests the card used. */
export async function homeDrill(ctx: Ctx, key: HomeDrill) {
  if (key === 'gifts' || key === 'over24' || key === 'first') {
    if (!mayGifts(ctx.scope)) return null;
    const g = await giftsResponse(ctx, '');
    const pick = key === 'gifts' ? g.rows : key === 'over24' ? g.rows.filter((r) => r.hours >= 24) : g.rows.filter((r) => r.badges.includes('First gift') || r.badges.includes('First monthly gift'));
    const rows = pick.map((r) => ({ id: r.giftId, date: r.date, partner: r.partner.name, place: r.partner.place, amount: r.amount, fund: r.fund, waiting: r.ageDays, badges: r.badges.join(', ') }));
    return { kind: 'gifts' as const, today: g.today, rows, total: key === 'gifts' ? g.stats.owed : key === 'over24' ? g.stats.over24 : g.stats.first, owner: g.owner };
  }
  const board = await currentBoard(ctx);
  const { pool, dueAll, row, portfolio } = duePool(ctx, board);
  const pickRows = key === 'open' ? [...pool].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)) : dueAll.filter((r) => (key === 'overdue' ? dayDiff(r.due, board.today) < 0 : key === 'today' ? dayDiff(r.due, board.today) === 0 : true)).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return { kind: 'actions' as const, today: board.today, scope: portfolio ? 'portfolio' : 'mine', rows: pickRows.map((r) => ({ ...row(r), late: r.due ? row(r).late : 0, summary: clip(r.summary || '', 120) })), total: pickRows.length };
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
  // Each action once, the same rows the Open actions tab counts, so the card's chip equals Today's work and the board.
  const all = { open: board.rows.length, overdue: board.rows.filter((r) => r.due && dayDiff(r.due, board.today) < 0).length, ty: board.rows.filter((r) => r.ty).length };
  return { people, total: by.size, all };
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
