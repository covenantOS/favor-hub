// The partner facts the briefing, the partner page and My partners share, read from the D1 copy of Blackbaud.
// Everything here is read only and goes through readOnly(), so the mirror never turns a statement away.
import { HttpError, nowIso, type Env } from '../http';
import { listStaff } from '../work/db';
import { givingForMany, type MirrorQ, type PartnerGiving } from '../gifts/partner-giving';
import { type Q, mirrorQ } from '../work/partner';
import { loadPortfolio, type Portfolio, type PortfolioRow } from '../work/portfolio';
import { readOnly } from '../work/repo';
import type { Ctx } from '../work/service';
import { type Cadence, type GiftPt, type Health, type MomentFacts, type Nba, type NbaFacts, type Rhythm, healthOf, nextAction, rhythmOf } from './signals';
import { addDays, dayDiff } from './text';

const TEAMS = new Set(['rdd', 'church', 'exec']);

export interface Director {
  fid: string;
  name: string;
  email: string;
  team: string;
}

/** The directors whose books this person may open: their own, the ones Support covers, or every director for an admin. */
export async function directorsFor(ctx: Ctx): Promise<Director[]> {
  const s = ctx.scope;
  const staff = (await listStaff(ctx.env)).filter((x) => x.active === 1 && x.bb_fundraiser_id && TEAMS.has(x.team));
  return staff
    .filter((x) => !s || s.all || s.fids.has(String(x.bb_fundraiser_id)))
    .map((x) => ({ fid: String(x.bb_fundraiser_id), name: x.name, email: x.email, team: x.team }));
}

export interface Book {
  owner: string;
  directors: Director[];
  portfolio: Portfolio | null;
}

/**
 * The partners one director holds, read the way My partners reads them and kept in the same ten-minute copy (act_cache pf:<owner>:<day>).
 * With no owner named, a director gets their own book; an admin or Support person gets none until they pick a director.
 */
export async function bookFor(ctx: Ctx, ownerIn: string, today: string): Promise<Book> {
  const directors = await directorsFor(ctx);
  const s = ctx.scope;
  const want = (ownerIn || '').replace(/\D/g, '');
  const mine = s && s.fid && directors.some((d) => d.fid === s.fid) ? s.fid : '';
  const owner = want || mine;
  if (!owner) return { owner: '', directors, portfolio: null };
  if (!directors.some((d) => d.fid === owner)) throw new HttpError(403, 'not_yours', 'That portfolio is not one you can open.');
  const key = `pf:${owner}:${today}`;
  const hit = await ctx.env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(key).first<{ value: string; at: string }>().catch(() => null);
  if (hit && Date.now() - Date.parse(hit.at) < 10 * 60000) {
    try {
      return { owner, directors, portfolio: JSON.parse(hit.value) as Portfolio };
    } catch {
      // an unreadable copy is rebuilt below
    }
  }
  const portfolio = await loadPortfolio(mirrorQ(ctx.env), owner, today);
  await ctx.env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
    .bind(key, JSON.stringify(portfolio), nowIso())
    .run()
    .catch(() => undefined);
  return { owner, directors, portfolio };
}

const EMAIL_FLAGS = readOnly(`SELECT constituent_record_id AS cid, COUNT(*) AS n, MAX(CASE WHEN COALESCE(do_not_email, 0) = 0 THEN 1 ELSE 0 END) AS ok
  FROM emails WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 GROUP BY 1`);

export interface PartnerRead {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  phone: string | null;
  doNotCall: boolean;
  hasEmail: boolean;
  doNotEmail: boolean;
  quiet: number | null;
  lastContact: { date: string; how: string } | null;
  l12: number;
  p12: number;
  ytd: number;
  life: number;
  count: number;
  firstDate: string;
  firstAmount: number;
  maxBefore: number;
  gifts: GiftPt[];
  rhythm: Rhythm;
  health: Health;
  why: string;
  next: { id: string; due: string; summary: string } | null;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Giving rhythm, health and the facts a next step needs, for every partner in a book. Three mirror reads per 400 partners. */
export async function readBook(q: Q, rows: PortfolioRow[], today: string): Promise<PartnerRead[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.cid);
  const since = addDays(today, -1100);
  const cut = addDays(today, -30);
  // One source for every gift figure: the household's credited giving (shared/giving.ts), so a DAF gift counts for the partner it names
  // and the list, the 12-month money, the largest gift and the first-gift date all agree.
  const giving = new Map<string, PartnerGiving>();
  const mail = new Map<string, { n: number; ok: number }>();
  for (const part of chunks(ids, 400)) {
    const J = JSON.stringify(part);
    const [g, m] = await Promise.all([givingForMany(q as unknown as MirrorQ, part, today).catch(() => new Map()), q<any>(EMAIL_FLAGS, [J]).catch(() => [])]);
    for (const [id, v] of g) giving.set(id, v);
    for (const x of m) mail.set(String(x.cid), { n: Number(x.n) || 0, ok: Number(x.ok) || 0 });
  }
  return rows.map((r) => {
    const pg = giving.get(r.cid);
    const all = pg ? pg.gifts.slice().reverse() : [];
    const gifts: GiftPt[] = all.filter((x) => x.date >= since).map((x) => ({ d: x.date, a: x.amount }));
    const firstDate = pg?.first || '';
    // The figures are the household's credited ones; the portfolio row's own sums are the fallback when the mirror read failed.
    const l12 = pg ? pg.last12 : r.l12;
    const p12 = pg ? Math.round(all.filter((x) => x.date > addDays(today, -730) && x.date <= addDays(today, -365)).reduce((t, x) => t + x.amount, 0) * 100) / 100 : r.p12;
    const life = pg ? pg.total : r.life;
    const count = pg ? pg.count : r.gifts;
    const rhythm = rhythmOf(gifts, today);
    const h = healthOf({ l12, p12, life, gifts: count, firstDate, quiet: r.quiet, rhythm, passedOn: pg ? pg.passedOn.count : 0 }, today);
    const first = all.find((x) => x.date === firstDate);
    const maxBefore = all.filter((x) => x.date < cut).reduce((m, x) => Math.max(m, x.amount), 0);
    const em = mail.get(r.cid);
    return {
      cid: r.cid,
      lookup: r.lookup,
      name: r.name,
      place: r.place,
      phone: r.phone,
      doNotCall: r.dnc,
      hasEmail: !!em && em.n > 0,
      doNotEmail: !!em && em.n > 0 && em.ok === 0,
      quiet: r.quiet,
      lastContact: r.last,
      l12,
      p12,
      ytd: pg ? pg.ytd : r.ytd,
      life,
      count,
      firstDate,
      firstAmount: first ? first.amount : 0,
      maxBefore,
      gifts,
      rhythm,
      health: h.health,
      why: h.why,
      next: r.next ? { id: r.next.id, due: r.next.due, summary: r.next.summary } : null,
    };
  });
}

export interface OwedSummary {
  n: number;
  total: number;
  oldestDays: number;
  fund?: string;
}

export function nbaOf(p: PartnerRead, today: string, owed: OwedSummary | null): Nba {
  const f: NbaFacts = {
    name: p.name,
    health: p.health,
    rhythm: p.rhythm,
    l12: p.l12,
    p12: p.p12,
    life: p.life,
    quiet: p.quiet,
    owed,
    firstGiftDays: p.count === 1 && p.firstDate ? Math.max(0, dayDiff(p.firstDate, today)) : null,
    nextTask: p.next && p.next.due ? { due: p.next.due, summary: p.next.summary } : null,
    hasPhone: !!p.phone || p.doNotCall,
    doNotCall: p.doNotCall,
    hasEmail: p.hasEmail,
    doNotEmail: p.doNotEmail,
  };
  return nextAction(f, today);
}

export const momentFacts = (p: PartnerRead): MomentFacts => ({
  cid: p.cid,
  name: p.name,
  gifts: p.gifts,
  count: p.count,
  firstDate: p.firstDate,
  firstAmount: p.firstAmount,
  maxBefore: p.maxBefore,
  health: p.health,
  rhythm: p.rhythm,
  l12: p.l12,
  phone: p.phone,
});

export type { Cadence, Env };
