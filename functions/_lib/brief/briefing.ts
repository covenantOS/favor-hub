// The morning briefing on Today: what came in overnight from your partners, who needs a thank-you, what is late, the moments worth a call.
// Partner content is built only for people the Work Center gate lets in (a person's own partners, the ones Support covers, or every
// partner for an admin). Everyone else gets the parts that are not about partners.
import { mirror } from '../foundations/blackbaud';
import { yourDayBlackbaud } from '../hub/actions';
import type { Env } from '../http';
import type { HubUser } from '../session';
import { blackbaudRepo, readOnly, FUNDS_SQL } from '../work/repo';
import { workAccessFor } from '../work/gate';
import { GIVEN } from '../work/gifts';
import { giftsResponse, lastWorkday, mayGifts } from '../work/gifts-svc';
import { mirrorQ } from '../work/partner';
import { scopeFor } from '../work/role';
import { todayEt, type Ctx } from '../work/service';
import { bookFor, momentFacts, nbaOf, readBook, type Director, type PartnerRead } from './facts';
import { momentsFor, type Moment } from './signals';
import { cacheGet, cachePut, dayDiff, money, plural } from './text';

const weekdayOf = (iso: string): string => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

export interface Line {
  id: string;
  text: string;
  sub?: string;
  href: string;
  /** 0 nothing special, 1 when there is time, 2 this week, 3 today. */
  urgency: number;
}

export interface OvernightGift {
  giftId: string;
  cid: string;
  name: string;
  place: string;
  amount: number;
  date: string;
  fund: string;
  thanked: boolean;
}

export interface ThankRow {
  key: string;
  giftId: string;
  cid: string;
  name: string;
  place: string;
  amount: number;
  date: string;
  ageDays: number;
  fund: string;
  badges: string[];
  phone: string | null;
  left: { date: string; how: string; by: string; remind: string } | null;
  tasks: number;
  team: string;
  owner: string;
}

export interface Briefing {
  ok: true;
  today: string;
  /** False for people the Work Center gate does not open: they get no partner content at all. */
  partners: boolean;
  owner: string;
  /** The signed-in person's own fundraiser id, when they hold a portfolio. */
  me: string;
  directors: Director[];
  since: string;
  overnight: { count: number; total: number; rows: OvernightGift[] } | null;
  thanks: { total: number; over24: number; rows: ThankRow[] } | null;
  late: { count: number; rows: Line[]; dueToday: Line[] } | null;
  moments: (Moment & { href: string })[];
  /** The next things to do, in order: late actions, thank-yous waiting longest, actions due today, then the top moment. Focus mode shows three. */
  focus: Line[];
  headline: string;
  at: string;
}

/** The Work Center context for this person, or null when the gate does not open for them. */
export async function workCtxFor(env: Env, user: HubUser, asEmail?: string): Promise<Ctx | null> {
  const email = (asEmail || user.email).toLowerCase();
  const admin = user.role === 'admin' && !asEmail;
  const access = await workAccessFor(env, email, admin).catch(() => null);
  if (!access || !access.ok) return null;
  const scope = (await scopeFor(env, email, admin).catch(() => null)) || { role: 'admin' as const, email, name: user.name, fid: null, team: '', all: false, fids: new Set<string>() };
  return { env, repo: blackbaudRepo(env), actor: user.name || email, email, scope, testCid: undefined };
}

const OVERNIGHT_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS cid, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS d, g.gift_splits AS splits,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name,
       json_extract(c.raw_json, '$.address.city') AS city, json_extract(c.raw_json, '$.address.state') AS st
  FROM gifts g JOIN constituents c ON c.id = g.constituent_record_id
 WHERE substr(g.gift_date, 1, 10) >= ?1 AND g.gift_amount > 0 AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
   AND (?2 = '[]' OR g.constituent_record_id IN (SELECT constituent_record_id FROM assignments WHERE assignment_fundraiser_id IN (SELECT value FROM json_each(?2))
        AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= ?3)))
 ORDER BY g.gift_amount DESC LIMIT 80`);

function fundNames(splits: unknown, names: Map<string, string>): string {
  let list: any[] = [];
  try {
    list = JSON.parse(String(splits || '[]'));
  } catch {
    return '';
  }
  return [...new Set(list.map((s) => names.get(String(s?.fund_id ?? ''))).filter(Boolean) as string[])].join(', ');
}

/** Gifts dated since the last workday on the partners this person may see. The scope is a list of fundraiser ids, or empty for every partner (admins). */
export async function overnightGifts(env: Env, fids: string[], today: string, since: string): Promise<{ count: number; total: number; rows: Omit<OvernightGift, 'thanked'>[] }> {
  const rows = await mirror<any>(env, OVERNIGHT_SQL, [since, JSON.stringify(fids), today]).catch(() => [] as any[]);
  const ids = new Set<string>();
  for (const r of rows) {
    try {
      for (const s of JSON.parse(r.splits || '[]')) if (s?.fund_id != null) ids.add(String(s.fund_id));
    } catch {
      // a split that does not parse is left out
    }
  }
  const names = new Map<string, string>();
  if (ids.size) for (const f of await mirror<{ id: string; name: string }>(env, readOnly(FUNDS_SQL), [JSON.stringify([...ids])]).catch(() => [])) names.set(String(f.id), f.name || '');
  const out = rows.map((r) => ({
    giftId: String(r.id),
    cid: String(r.cid),
    name: String(r.name || '').replace(/\s+/g, ' ').trim() || `Record ${r.cid}`,
    place: [r.city, r.st].filter(Boolean).join(', '),
    amount: Number(r.amount) || 0,
    date: String(r.d),
    fund: fundNames(r.splits, names),
  }));
  return { count: out.length, total: out.reduce((n, g) => n + g.amount, 0), rows: out };
}

export interface BriefInput {
  env: Env;
  user: HubUser;
  ctx: Ctx | null;
  ownerIn: string;
  today?: string;
}

/** The thank-you rows the briefing lists: oldest first, then largest. */
function thankRows(g: Awaited<ReturnType<typeof giftsResponse>>): ThankRow[] {
  return [...g.rows]
    .filter((r) => !r.left || r.ageDays >= 2)
    .sort((a, b) => b.ageDays - a.ageDays || b.amount - a.amount)
    .map((r) => ({
      key: r.key,
      giftId: r.giftId,
      cid: r.cid,
      name: r.partner.name,
      place: r.partner.place,
      amount: r.amount,
      date: r.date,
      ageDays: r.ageDays,
      fund: r.fund,
      badges: r.badges.slice(0, 2),
      phone: r.partner.doNotCall ? null : r.partner.phone,
      left: r.left,
      tasks: r.taskIds.length,
      team: r.team,
      owner: r.owners[0] || '',
    }));
}

export async function buildBriefing(i: BriefInput): Promise<Briefing> {
  const { env, user, ctx } = i;
  const today = i.today || todayEt();
  const since = lastWorkday(today);
  const email = user.email.toLowerCase();

  const lateP = (async () => {
    const day = await yourDayBlackbaud((sql, params) => mirror(env, sql, params), email, today);
    const overdue = (day.actions || []).filter((a: any) => a.due && a.due < today);
    const dueToday = (day.actions || []).filter((a: any) => a.due === today);
    return {
      dueToday: dueToday.slice(0, 4).map((a: any): Line => ({ id: `act:${a.id}`, text: String(a.summary || a.type || 'Action').slice(0, 90), sub: a.partner ? String(a.partner) : 'Due today', href: `/work/?action=${encodeURIComponent(a.id)}`, urgency: 2 })),
      count: Number(day.overdue) || overdue.length,
      rows: overdue.slice(0, 4).map((a: any): Line => ({
        id: `act:${a.id}`,
        text: String(a.summary || a.type || 'Action').slice(0, 90),
        sub: `${a.partner ? a.partner + ', ' : ''}${plural(Math.max(1, dayDiff(a.due, today)), 'day')} late`,
        href: `/work/?action=${encodeURIComponent(a.id)}`,
        urgency: 3,
      })),
    };
  })().catch(() => null);

  let partners = false;
  let owner = '';
  let directors: Director[] = [];
  let overnight: Briefing['overnight'] = null;
  let thanks: Briefing['thanks'] = null;
  let moments: Briefing['moments'] = [];
  let reads: PartnerRead[] = [];

  if (ctx && ctx.scope) {
    partners = true;
    const s = ctx.scope;
    const book = await bookFor(ctx, i.ownerIn, today).catch(() => ({ owner: '', directors: [] as Director[], portfolio: null }));
    owner = book.owner;
    directors = book.directors;
    const fids = book.owner ? [book.owner] : s.all ? [] : [...s.fids];
    const [night, gifts] = await Promise.all([
      overnightGifts(env, fids, today, since).catch(() => null),
      mayGifts(s) ? giftsResponse(ctx, book.owner).catch(() => null) : Promise.resolve(null),
    ]);
    const owed = gifts ? thankRows(gifts) : [];
    const owedIds = new Set(gifts ? gifts.rows.map((r) => r.giftId) : []);
    if (night) overnight = { count: night.count, total: night.total, rows: night.rows.slice(0, 8).map((g) => ({ ...g, thanked: !!gifts && !owedIds.has(g.giftId) })) };
    if (gifts) thanks = { total: gifts.stats.owed, over24: gifts.stats.over24, rows: owed.slice(0, 6) };
    if (book.portfolio && book.portfolio.rows.length) {
      reads = await readBook(mirrorQ(env), book.portfolio.rows, today).catch(() => []);
      moments = momentsFor(reads.map(momentFacts), today, 10).map((m) => ({ ...m, href: `/work/partner/${encodeURIComponent(m.cid)}` }));
    } else if (!book.owner && book.directors.length) {
      // No portfolio of their own (an admin, or Support): the moments of every director they cover, kept for half an hour.
      const key = `moments:${email}:${today}`;
      const hit = await cacheGet<Briefing['moments']>(env, key, 30 * 60000);
      if (hit) moments = hit;
      else {
        const all: Moment[] = [];
        for (const d of book.directors.slice(0, 14)) {
          const b = await bookFor(ctx, d.fid, today).catch(() => null);
          if (!b || !b.portfolio || !b.portfolio.rows.length) continue;
          const r = await readBook(mirrorQ(env), b.portfolio.rows, today).catch(() => []);
          all.push(...momentsFor(r.map(momentFacts), today, 4));
        }
        const seen = new Set<string>();
        const KIND: Record<string, number> = { largest: 0, first: 1, quiet: 2, anniversary: 3 };
        moments = all
          .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
          .sort((a, b) => KIND[a.kind] - KIND[b.kind] || (b.amount || 0) - (a.amount || 0))
          .slice(0, 10)
          .map((m) => ({ ...m, href: `/work/partner/${encodeURIComponent(m.cid)}` }));
        await cachePut(env, key, moments);
      }
    }
  }

  const late = await lateP;
  const focus: Line[] = [
    ...(late ? late.rows.map((l) => ({ ...l, sub: l.sub })) : []),
    ...(thanks ? thanks.rows.slice(0, 4).map((t): Line => ({ id: `thank:${t.giftId}`, text: `Thank ${t.name} for ${money(t.amount)}`, sub: t.ageDays >= 1 ? `Waiting ${plural(t.ageDays, 'day')}` : 'Gave today', href: `/work/partner/${encodeURIComponent(t.cid)}`, urgency: t.ageDays >= 3 ? 3 : 2 })) : []),
    ...(late ? late.dueToday : []),
    ...moments.slice(0, 2).map((m): Line => ({ id: `moment:${m.id}`, text: `${m.step.label}: ${m.name}`, sub: m.line, href: m.href, urgency: 1 })),
  ].slice(0, 8);
  const lines: string[] = [];
  if (thanks && thanks.total) lines.push(`${plural(thanks.total, 'thank-you')} waiting${thanks.over24 ? `, ${thanks.over24} for more than a day` : ''}`);
  if (late && late.count) lines.push(`${plural(late.count, 'late action')}`);
  if (overnight && overnight.count) lines.push(`${plural(overnight.count, 'gift')} since ${weekdayOf(since)}, ${money(overnight.total)}`);
  const headline = lines.length ? lines.join('. ') + '.' : '';
  return { ok: true, today, partners, owner, me: (ctx && ctx.scope && ctx.scope.fid) || '', directors, since, overnight, thanks, late, moments, focus, headline, at: new Date().toISOString() };
}
