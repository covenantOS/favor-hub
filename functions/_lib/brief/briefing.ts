// The morning briefing on Today: what came in overnight from your partners, who needs a thank-you, what is late, the moments worth a call.
// Partner content is built only for people the Work Center gate lets in (a person's own partners, the ones Support covers, or every
// partner for an admin). Everyone else gets the parts that are not about partners.
import { mirror } from '../foundations/blackbaud';
import { money, softOf, throughName, whole } from '../../../shared/giving';
import { throughNames } from '../gifts/partner-giving';
import { yourDayBlackbaud } from '../hub/actions';
import type { Env } from '../http';
import type { HubUser } from '../session';
import { blackbaudRepo, readOnly, FUNDS_SQL } from '../work/repo';
import { workAccessFor } from '../work/gate';
import { hubThanks } from '../work/gifts';
import { byClock, clockLabel, type ClockState } from '../work/thank-clock';
import { giftsResponse, lastWorkday, mayGifts } from '../work/gifts-svc';
import { mirrorQ } from '../work/partner';
import { scopeFor } from '../work/role';
import { todayEt, type Ctx } from '../work/service';
import { bookFor, momentFacts, nbaOf, readBook, type Director, type PartnerRead } from './facts';
import { momentsFor, type Moment } from './signals';
import { cacheGet, cachePut, dayDiff, plural } from './text';

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
  /** What counts for this partner: the whole gift, or the part a soft credit names. */
  amount: number;
  date: string;
  fund: string;
  /** True only when a thank-you is on record for this gift. Never inferred from the gift being absent from the owed list. */
  thanked: boolean;
  /** A soft credit: the record the gift came through, "National Christian Foundation (DAF)". Empty for a gift the partner gave. */
  through: string;
  /** The record the gift sits on. */
  giver: string;
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
  /** When the 24-hour thank-you is due, and whether it is on the clock, late or Older. */
  due: string;
  state: ClockState;
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
  /** rows: the gifts on the 24-hour clock, least time left first. older: the first few whose clock ran out more than a day ago. */
  thanks: { total: number; over24: number; onClock: number; olderN: number; rows: ThankRow[]; older: ThankRow[] } | null;
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

// Gifts since a date, by the one giving rule (shared/giving.ts): a gift counts when it is over $0, dated and not a RecurringGift schedule;
// a gift with soft credits counts for the partners it names, never for the record it sits on.
const HELD_NOW = readOnly(`SELECT DISTINCT constituent_record_id AS cid FROM assignments
 WHERE assignment_fundraiser_id IN (SELECT value FROM json_each(?1)) AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= ?2)`);

const NEW_GIFTS_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS giver, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS d, g.gift_splits AS splits, g.soft_credits AS soft
  FROM gifts g
 WHERE substr(g.gift_date, 1, 10) >= ?1 AND substr(g.gift_date, 1, 10) <= ?2 AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift'
   AND (?3 = '[]' OR g.constituent_record_id IN (SELECT value FROM json_each(?3))
        OR (g.soft_credits IS NOT NULL AND g.soft_credits NOT IN ('', '[]')
            AND EXISTS (SELECT 1 FROM json_each(g.soft_credits) s WHERE json_extract(s.value, '$.constituent_id') IN (SELECT value FROM json_each(?3)))))`);

const PEOPLE_SQL = readOnly(`SELECT id, spouse_id AS sid, COALESCE(json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name,
       json_extract(raw_json, '$.address.city') AS city, json_extract(raw_json, '$.address.state') AS st
  FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`);

/** The most rows the list carries. The count and the total never use this cap. */
export const OVERNIGHT_LIST_MAX = 80;

function fundNames(splits: unknown, names: Map<string, string>): string {
  let list: any[] = [];
  try {
    list = JSON.parse(String(splits || '[]'));
  } catch {
    return '';
  }
  return [...new Set(list.map((s) => names.get(String(s?.fund_id ?? ''))).filter(Boolean) as string[])].join(', ');
}

/** Who one gift counts for and how much each: the giver for a gift with no soft credits, else each partner the soft credits name (never more than the gift). */
export function creditsOf(giver: string, amount: number, softRaw: unknown): { cid: string; amount: number }[] {
  const soft = softOf(softRaw);
  if (!soft.length) return [{ cid: giver, amount }];
  const by = new Map<string, number>();
  for (const s of soft) by.set(s.cid, (by.get(s.cid) || 0) + (s.amount ?? amount));
  return [...by.entries()].map(([cid, a]) => ({ cid, amount: Math.min(amount, a) })).filter((c) => c.amount > 0);
}

interface GiftLine {
  giftId: string;
  cid: string;
  giver: string;
  amount: number;
  date: string;
  splits: unknown;
  via: boolean;
}

/**
 * Gifts dated from `since` through `today` for the partners this person may see. A gift sent through a donor-advised fund, foundation or
 * business counts for the partner it names, with "through <that record>" beside it, never for the record it sits on. The scope is a list
 * of fundraiser ids, or empty for every partner (admins). Count and total cover every gift; only the listed rows are capped.
 */
export async function overnightGifts(env: Env, fids: string[], today: string, since: string): Promise<{ count: number; total: number; rows: Omit<OvernightGift, 'thanked'>[] }> {
  const q = mirrorQ(env);
  let scope: Set<string> | null = null;
  if (fids.length) {
    scope = new Set((await q(HELD_NOW, [JSON.stringify(fids), today]).catch(() => [] as any[])).map((r: any) => String(r.cid)));
    if (!scope.size) return { count: 0, total: 0, rows: [] };
  }
  const gifts = await q(NEW_GIFTS_SQL, [since, today, JSON.stringify(scope ? [...scope] : [])]).catch(() => [] as any[]);
  const people = new Map<string, any>();
  const want = new Set<string>();
  for (const g of gifts) {
    want.add(String(g.giver));
    for (const c of creditsOf(String(g.giver), Number(g.amount) || 0, g.soft)) want.add(c.cid);
  }
  for (const r of await q(PEOPLE_SQL, [JSON.stringify([...want])]).catch(() => [] as any[])) people.set(String(r.id), r);
  const lines: GiftLine[] = [];
  let total = 0;
  for (const g of gifts) {
    const amount = Number(g.amount) || 0;
    const credits = creditsOf(String(g.giver), amount, g.soft);
    const mine = credits.filter((c) => !scope || scope.has(c.cid));
    // Spouses linked in Blackbaud are one household: a gift naming both is one line, and a household never gets more than the gift.
    const taken = new Set<string>();
    for (const c of mine) {
      if (taken.has(c.cid)) continue;
      const sid = people.get(c.cid)?.sid ? String(people.get(c.cid).sid) : '';
      const mates = mine.filter((o) => o.cid === c.cid || o.cid === sid || String(people.get(o.cid)?.sid || '') === c.cid);
      for (const m of mates) taken.add(m.cid);
      const amt = Math.min(amount, mates.reduce((t, m) => t + m.amount, 0));
      total += amt;
      lines.push({ giftId: String(g.id), cid: c.cid, giver: String(g.giver), amount: Math.round(amt * 100) / 100, date: String(g.d), splits: g.splits, via: !mates.some((m) => m.cid === String(g.giver)) });
    }
  }
  const count = new Set(lines.map((r) => r.giftId)).size;
  const shown = lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount)).slice(0, OVERNIGHT_LIST_MAX);
  const ids = new Set<string>();
  for (const r of shown) {
    try {
      for (const s of JSON.parse(String(r.splits || '[]'))) if (s?.fund_id != null) ids.add(String(s.fund_id));
    } catch {
      // a split that does not parse is left out
    }
  }
  const names = new Map<string, string>();
  if (ids.size) for (const f of await mirror<{ id: string; name: string }>(env, readOnly(FUNDS_SQL), [JSON.stringify([...ids])]).catch(() => [])) names.set(String(f.id), f.name || '');
  const via = await throughNames(q, shown.filter((r) => r.via).map((r) => r.giver)).catch(() => new Map<string, { name: string; kind: string }>());
  const rows = shown.map((r) => {
    const p = people.get(r.cid);
    const v = r.via ? via.get(r.giver) || { name: String(people.get(r.giver)?.name || `Record ${r.giver}`), kind: 'organization' } : null;
    return {
      giftId: r.giftId,
      cid: r.cid,
      name: String((p && p.name) || '').replace(/\s+/g, ' ').trim() || `Record ${r.cid}`,
      place: p ? [p.city, p.st].filter(Boolean).join(', ') : '',
      amount: r.amount,
      date: r.date,
      fund: fundNames(r.splits, names),
      through: v ? throughName(v) : '',
      giver: r.giver,
    };
  });
  return { count, total: Math.round(total * 100) / 100, rows };
}

/**
 * The listed gifts that have a thank-you on record: the hub's own record (talked or sent), or a completed thank-you tag, mailing or call
 * in Blackbaud on or after the gift date on the partner (or, for a soft credit, the record it came through). Keys are "giftId|partnerId".
 */
export async function thankedOf(env: Env, rows: { giftId: string; cid: string; giver?: string; through?: string; date: string }[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!rows.length) return out;
  const hub = await hubThanks(env, [...new Set(rows.map((r) => r.giftId))]).catch(() => []);
  for (const t of hub) if (t.outcome === 'talked' || t.outcome === 'sent') out.add(`${t.gift_id}|${t.cid}`);
  const who = [...new Set(rows.flatMap((r) => [r.cid, ...(r.through && r.giver ? [r.giver] : [])]))];
  const from = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
  const ev = await mirrorQ(env)(
    `SELECT a.constituent_record_id AS cid, substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS d
       FROM actions a LEFT JOIN action_tags t ON t.id = a.id
      WHERE a.constituent_record_id IN (SELECT value FROM json_each(?1)) AND json_extract(a.raw_json, '$.completed') = 1
        AND substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) >= ?2 AND (COALESCE(t.thanked, 0) = 1 OR a.action_category IN ('Mailing', 'Phone call'))`,
    [JSON.stringify(who), from]
  ).catch(() => [] as any[]);
  const byCid = new Map<string, string[]>();
  for (const e of ev) (byCid.get(String(e.cid)) || byCid.set(String(e.cid), []).get(String(e.cid))!).push(String(e.d));
  for (const r of rows) {
    const ids = [r.cid, ...(r.through && r.giver ? [r.giver] : [])];
    if (ids.some((w) => (byCid.get(w) || []).some((d) => d >= r.date))) out.add(`${r.giftId}|${r.cid}`);
  }
  return out;
}

export interface BriefInput {
  env: Env;
  user: HubUser;
  ctx: Ctx | null;
  ownerIn: string;
  today?: string;
}

/** The thank-you rows the briefing lists, in clock order: least time left first, then the ones that ran out, then Older. */
function thankRows(g: Awaited<ReturnType<typeof giftsResponse>>): ThankRow[] {
  return [...g.rows]
    .filter((r) => !r.left || r.ageDays >= 2)
    .sort(byClock)
    .map((r) => ({
      key: r.key,
      giftId: r.giftId,
      cid: r.cid,
      name: r.partner.name,
      place: r.partner.place,
      amount: r.amount,
      date: r.date,
      ageDays: r.ageDays,
      due: r.clock.due,
      state: r.clock.state,
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
      mayGifts(s) ? giftsResponse(ctx, book.owner, { mine: !i.ownerIn && !book.owner }).catch(() => null) : Promise.resolve(null),
    ]);
    const owed = gifts ? thankRows(gifts) : [];
    if (night) {
      const listed = night.rows.slice(0, 8);
      const done = await thankedOf(env, listed).catch(() => new Set<string>());
      overnight = { count: night.count, total: night.total, rows: listed.map((g) => ({ ...g, thanked: done.has(`${g.giftId}|${g.cid}`) })) };
    }
    if (gifts) {
      const cur = owed.filter((r) => r.state !== 'older');
      thanks = { total: gifts.stats.owed, over24: gifts.stats.over24, onClock: cur.length, olderN: owed.length - cur.length, rows: cur.slice(0, 6), older: owed.filter((r) => r.state === 'older').slice(0, 6) };
    }
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
          const b = await bookFor(ctx, d.fid, today).catch((e) => { console.error('[brief] book', d.fid, String(e && e.message || e)); return null; });
          if (!b || !b.portfolio || !b.portfolio.rows.length) continue;
          const r = await readBook(mirrorQ(env), b.portfolio.rows, today).catch((e) => { console.error('[brief] read', d.fid, String(e && e.message || e)); return []; });
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
    ...(thanks ? thanks.rows.slice(0, 4).map((t): Line => ({ id: `thank:${t.giftId}`, text: `Thank ${t.name} for ${money(t.amount)}`, sub: clockLabel(t.due, Date.now()), href: `/work/partner/${encodeURIComponent(t.cid)}`, urgency: t.state === 'due' ? 2 : 3 })) : []),
    ...(late ? late.dueToday : []),
    ...moments.slice(0, 2).map((m): Line => ({ id: `moment:${m.id}`, text: `${m.step.label}: ${m.name}`, sub: m.line, href: m.href, urgency: 1 })),
  ].slice(0, 8);
  const lines: string[] = [];
  if (thanks && thanks.total) lines.push(`${plural(thanks.total, 'thank-you')} waiting${thanks.onClock ? `, ${thanks.onClock} on the 24-hour clock` : ''}`);
  if (late && late.count) lines.push(`${plural(late.count, 'late action')}`);
  if (overnight && overnight.count) lines.push(`${plural(overnight.count, 'gift')} since ${weekdayOf(since)}, ${whole(overnight.total)}`);
  const headline = lines.length ? lines.join('. ') + '.' : '';
  return { ok: true, today, partners, owner, me: (ctx && ctx.scope && ctx.scope.fid) || '', directors, since, overnight, thanks, late, moments, focus, headline, at: new Date().toISOString() };
}
