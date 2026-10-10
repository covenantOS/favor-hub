// Shared by the daily and weekly reports (group B1): money and date text the way the Daily Revenue Reporter 4.2 prints them,
// the gift grid it reads (one row per gift split, one more per soft credit), and the post builder ported line for line.
// Reads only, through ctx.sql. Every name and figure in the tests is made up; the staff names below are the roles the
// browser script already holds (regional directors and the people the post shortens to a first name).
import type { ReportContext } from '../types';

/* ------------------------------------------------------------------ text */

export function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 });
}
export const round2 = (x: number): number => Math.round(x * 100) / 100;
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number): string => MONTHS[m - 1];

/** 1st, 2nd, 3rd, 4th to 20th, 21st, 22nd, 23rd, 31st: the script's own ordinal. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
/** October 9th, 2026, from 2026-10-09. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${ordinal(d)}, ${y}`;
}
export function addDays(iso: string, n: number): string {
  const t = new Date(iso + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** 0 Sunday to 6 Saturday. */
export const weekday = (iso: string): number => new Date(iso + 'T12:00:00Z').getUTCDay();
export function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export const easternHour = (now = new Date()): number => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now)) % 24;

/** What the Daily Revenue Report covers by default: yesterday, or Friday through Sunday on a Monday. */
export function lastBusinessRange(today: string): { from: string; to: string } {
  const dow = weekday(today);
  if (dow === 1) return { from: addDays(today, -3), to: addDays(today, -1) };
  return { from: addDays(today, -1), to: addDays(today, -1) };
}

/* ------------------------------------------------------------------ lookups held in the script */

const US_REGIONS: Record<string, string[]> = {
  'Curtis Wilson': ['CT', 'DE', 'DC', 'IN', 'KY', 'ME', 'MD', 'MA', 'MI', 'NH', 'NJ', 'NY', 'OH', 'PA', 'RI', 'VT', 'VA', 'WV'],
  'David Morton': ['IL', 'IA', 'MN', 'MO', 'NE', 'ND', 'SD', 'WI', 'CO', 'KS', 'TN', 'NC'],
  'Brian Carr': ['ID', 'MT', 'OR', 'WA', 'WY', 'CA', 'NV', 'UT'],
  'Richard Brown': ['AL', 'AR', 'FL', 'GA', 'LA', 'MS', 'SC'],
  'Brad Cutsinger': ['TX', 'NM', 'AZ'],
  'Stephanie Brady': ['OK'],
};
export const DIRECTORS = ['Curtis Wilson', 'David Morton', 'Brian Carr', 'Richard Brown', 'Brad Cutsinger', 'Celeste Paul', 'Joe Krol', 'Josh Milliron', 'Stephanie Brady'];
const STATE_DIRECTOR: Record<string, string> = {};
for (const [dir, sts] of Object.entries(US_REGIONS)) for (const st of sts) STATE_DIRECTOR[st] = dir;

const OTHER_CATEGORIES: Record<string, string> = {
  A: 'Advocate', B: 'Book', C: 'Influenced Giving', D: 'E-blast', E: 'Event', F: 'Flyer', K: 'Acquisition', M: 'Media', N: 'Digital Newsletter', P: 'PC Portfolio',
  R: 'Reactivation', S: 'Speaking Engagement', T: 'TV', X: 'Special Mailout', Z: 'Other/Exception',
};

// Long name to short name, applied in this order to the whole finished post.
const ABBREVS: Record<string, string> = {
  ABS: 'American Bible Society',
  'Bank of America': 'Bank of America Charitable Gift Fund',
  'Bill & Carol Latimer': 'Bill and Carol Latimer - Charitable Foundation',
  DAF: 'Donor Advised Fund',
  ICM: 'International Cooperating Ministries',
  IGI: 'Innovations for Gospel Impact',
  'IHS Foundation': 'In His Steps Foundation',
  NCF: 'National Christian Foundation',
  PBT: 'Pioneer Bible Translators',
  RZIM: 'Ravi Zacharias International Ministries',
  VOM: 'Voice of the Martyrs',
  WOF: 'World Outreach Fund',
  Carole: 'Carole Ward',
  Terry: 'Terry Goodman',
  David: 'David Morton',
  Rick: 'Richard Brown',
  Brad: 'Brad Cutsinger',
  Brian: 'Brian Carr',
  Josh: 'Josh Milliron',
  Celeste: 'Celeste Paul',
  Joe: 'Joe Krol',
  Curtis: 'Curtis Wilson',
  Stephanie: 'Stephanie Brady',
};

/* ------------------------------------------------------------------ the grid */

/** One row of the Daily Revenue Reporter query: a gift split, or a soft credit on a split. */
export interface GridRow {
  partner: string;
  softCredit: string;
  firstGiftID: string;
  giftID: string;
  fullAmount: number;
  date: string;
  appealAmount: number;
  appealID: string;
  appealCat: string;
  fund: string;
  giftType: string;
  consistent: string;
  totalGiving: number;
  fundraiser: string;
  state: string;
  country: string;
}
export interface GridGift {
  /** The record id the mirror and the tag list use. */
  id: string;
  /** The Gift ID staff know, which is the lookup id the query prints. */
  lookup: string;
  date: string;
  donorId: string;
  method: string;
  type: string;
  rows: GridRow[];
}

interface RawGift {
  id: string;
  lid: string | null;
  cid: string;
  amount: number;
  d: string;
  gtype: string;
  pm: string;
  splits: string | null;
  soft: string | null;
}

function parse<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Open assignments held by these three fundraiser records do not show in the query's Fundraiser column (query 1148 leaves them out). */
const EXCLUDED_FUNDRAISERS = ['32148', '32295', '33656'];

const COUNTRY: Record<string, string> = { 'United States': 'US', Australia: 'AU', 'New Zealand': 'NZ' };

/** Every gift from `from` to `to` (inclusive, YYYY-MM-DD) except Recurring Gift setups and zero or negative amounts, shaped as the query grid. */
export async function loadGrid(ctx: ReportContext, from: string, to: string, limit = 5000): Promise<GridGift[]> {
  const gifts = await ctx.sql<RawGift>(
    `SELECT id AS id, json_extract(raw_json, '$.lookup_id') AS lid, constituent_record_id AS cid, gift_amount AS amount, substr(gift_date, 1, 10) AS d, gift_type AS gtype, gift_payment_method AS pm,
            gift_splits AS splits, soft_credits AS soft
       FROM gifts WHERE substr(gift_date, 1, 10) >= ?1 AND substr(gift_date, 1, 10) <= ?2 AND gift_amount > 0 AND gift_type <> 'RecurringGift'
      ORDER BY gift_date, id LIMIT ${limit}`,
    [from, to]
  );
  if (!gifts.length) return [];
  const people = new Set<string>();
  const appeals = new Set<string>();
  const funds = new Set<string>();
  const parsed = gifts.map((g) => {
    const splits = parse<Array<{ amount?: { value?: number }; appeal_id?: string; fund_id?: string }>>(g.splits, []);
    const soft = parse<Array<{ constituent_id?: string }>>(g.soft, []);
    if (g.cid) people.add(String(g.cid));
    for (const s of soft) if (s.constituent_id) people.add(String(s.constituent_id));
    for (const s of splits) {
      if (s.appeal_id) appeals.add(String(s.appeal_id));
      if (s.fund_id) funds.add(String(s.fund_id));
    }
    return { g, splits, soft };
  });
  const ids = JSON.stringify([...people]);
  const [names, stats, softs, ap, fu, frs, assigns, cons] = await Promise.all([
    ctx.sql<{ id: string; name: string; sk: string | null; st: string | null; country: string | null }>(
      `SELECT c.id AS id,
              CASE WHEN c.constituent_type = 'Organization' THEN COALESCE(c.organization_name, json_extract(c.raw_json, '$.name'))
                   ELSE COALESCE(c.first_name, '') || ' ' || CASE WHEN COALESCE(c.middle_name, '') = '' THEN '' ELSE substr(c.middle_name, 1, 1) || '. ' END || COALESCE(c.last_name, '') END AS name,
              CASE WHEN c.constituent_type = 'Organization' THEN lower(COALESCE(c.organization_name, '')) ELSE lower(COALESCE(c.last_name, '') || ' ' || COALESCE(c.first_name, '')) END AS sk,
              (SELECT a.address_state FROM addresses a WHERE a.constituent_record_id = c.id AND a.is_primary = 1 AND COALESCE(a.is_inactive, 0) = 0 LIMIT 1) AS st,
              (SELECT a.address_country FROM addresses a WHERE a.constituent_record_id = c.id AND a.is_primary = 1 AND COALESCE(a.is_inactive, 0) = 0 LIMIT 1) AS country
         FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`,
      [ids]
    ),
    ctx.sql<{ cid: string; life: number; fk: string | null }>(
      `SELECT g.constituent_record_id AS cid, SUM(CASE WHEN g.gift_type <> 'RecurringGift' THEN g.gift_amount ELSE 0 END) AS life,
              (SELECT g2.gift_date || '|' || COALESCE(json_extract(g2.raw_json, '$.lookup_id'), g2.id) FROM gifts g2 WHERE g2.constituent_record_id = g.constituent_record_id AND g2.gift_amount > 0 ORDER BY g2.gift_date, g2.id LIMIT 1) AS fk
         FROM gifts g WHERE g.constituent_record_id IN (SELECT value FROM json_each(?1)) AND g.gift_amount > 0 GROUP BY 1`,
      [ids]
    ),
    // Total Amount of Gifts counts a gift a partner received a soft credit for, at its full amount, and First Gift ID can be such a gift.
    ctx.sql<{ cid: string; s: number; fk: string | null }>(
      `SELECT json_extract(sc.value, '$.constituent_id') AS cid, SUM(g.gift_amount) AS s, MIN(g.gift_date || '|' || COALESCE(json_extract(g.raw_json, '$.lookup_id'), g.id)) AS fk FROM gifts g, json_each(g.soft_credits) sc
        WHERE g.soft_credits LIKE '[{%' AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND json_extract(sc.value, '$.constituent_id') IN (SELECT value FROM json_each(?1)) GROUP BY 1`,
      [ids]
    ),
    ctx.sql<{ id: string; code: string; cat: string }>(`SELECT id AS id, appeal_id AS code, appeal_category AS cat FROM appeals WHERE id IN (SELECT value FROM json_each(?1))`, [JSON.stringify([...appeals])]),
    ctx.sql<{ id: string; fund: string }>(`SELECT id AS id, fund_id AS fund FROM funds WHERE id IN (SELECT value FROM json_each(?1))`, [JSON.stringify([...funds])]),
    ctx.sql<{ id: string; first: string; last: string }>(`SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers`),
    ctx.sql<{ cid: string; fid: string }>(
      `SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid FROM assignments
        WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND assignment_to_date IS NULL AND assignment_fundraiser_id NOT IN (SELECT value FROM json_each(?2))`,
      [ids, JSON.stringify(EXCLUDED_FUNDRAISERS)]
    ),
    ctx.sql<{ gift_id: string }>(`SELECT DISTINCT gift_id FROM gift_custom_fields WHERE category = 'Consistent Gift' AND value = 'ConsistentGift' AND gift_id IN (SELECT value FROM json_each(?1))`, [JSON.stringify(gifts.map((g) => g.id))]),
  ]);
  const nameOf = new Map(names.map((n) => [String(n.id), n]));
  const statOf = new Map(stats.map((s) => [String(s.cid), s]));
  const softOf = new Map(softs.map((s) => [String(s.cid), s]));
  const appealOf = new Map(ap.map((a) => [String(a.id), a]));
  const fundOf = new Map(fu.map((f) => [String(f.id), f.fund]));
  const raiser = new Map(frs.map((f) => [String(f.id), `${txt(f.first)} ${txt(f.last)}`.trim()]));
  const consistent = new Set(cons.map((c) => String(c.gift_id)));
  // The query's Fundraiser column is the partner's open assignments, one row each. A fundraiser the table does not hold is read by record name.
  const held = new Map<string, string[]>();
  for (const a of assigns) {
    const list = held.get(String(a.cid)) || [];
    if (!list.includes(String(a.fid))) list.push(String(a.fid));
    held.set(String(a.cid), list);
  }
  const unknown = [...new Set(assigns.map((a) => String(a.fid)).filter((id) => !raiser.has(id)))];
  if (unknown.length) {
    const more = await ctx.sql<{ id: string; name: string }>(
      `SELECT c.id AS id, COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`,
      [JSON.stringify(unknown)]
    );
    for (const m of more) raiser.set(String(m.id), txt(m.name));
  }
  const fundraisersOf = (cid: string): string[] => {
    const names = (held.get(cid) || []).map((id) => raiser.get(id) || '').filter(Boolean);
    return names.length ? [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : [''];
  };

  return parsed.map(({ g, splits, soft }) => {
    const giftID = txt(g.lid) || String(g.id);
    const recordId = String(g.id);
    const who = (cid: string) => {
      const n = nameOf.get(cid);
      const st = statOf.get(cid);
      const country = n?.country ? COUNTRY[n.country] || n.country : n?.st ? 'US' : '';
      const sf = softOf.get(cid);
      const keys = [st?.fk, sf?.fk].filter((k): k is string => !!k).sort();
      return { name: txt(n?.name), state: txt(n?.st), country, first: keys.length ? keys[0].slice(keys[0].indexOf('|') + 1) : '', life: round2(num(st?.life) + num(sf?.s)) };
    };
    const entries: Array<{ soft: string; sk: string; fr: string; row: GridRow }> = [];
    const base = (cid: string, softName: string, fundraiser: string, sp: { amount?: { value?: number }; appeal_id?: string; fund_id?: string }): GridRow => {
      const w = who(cid);
      const a = sp.appeal_id ? appealOf.get(String(sp.appeal_id)) : undefined;
      return {
        partner: w.name,
        softCredit: softName,
        firstGiftID: w.first,
        giftID,
        fullAmount: num(g.amount),
        date: g.d,
        appealAmount: num(sp.amount?.value),
        appealID: txt(a?.code),
        appealCat: txt(a?.cat),
        fund: sp.fund_id ? txt(fundOf.get(String(sp.fund_id))) : '',
        giftType: g.gtype === 'RecurringGiftPayment' ? 'Recurring Gift Payment' : g.gtype === 'Donation' ? 'One-Time Gift' : txt(g.gtype),
        consistent: consistent.has(recordId) ? 'Consistent' : '',
        totalGiving: w.life,
        fundraiser,
        state: w.state,
        country: w.country,
      };
    };
    const useSplits = splits.length ? splits : [{ amount: { value: num(g.amount) } }];
    const seen = new Set<string>();
    const softs: Array<{ cid: string; nm: string }> = [];
    for (const sc of soft) {
      const cid = String(sc.constituent_id || '');
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      softs.push({ cid, nm: txt(nameOf.get(cid)?.name) });
    }
    // The query sorts by gift, then Soft Credit Recipient (a blank one first), then the partner's sort name, then the fundraiser.
    // With a soft credit the query prints the donor's row with the recipient's name in Soft Credit Recipient, then the recipient's own row.
    softs.sort((a, b) => (a.nm < b.nm ? -1 : a.nm > b.nm ? 1 : 0));
    if (!softs.length) {
      for (const fr of fundraisersOf(String(g.cid))) for (const sp of useSplits) entries.push({ soft: '', sk: txt(nameOf.get(String(g.cid))?.sk), fr, row: base(String(g.cid), '', fr, sp) });
    }
    for (const sc of softs) {
      for (const fr of fundraisersOf(String(g.cid))) for (const sp of useSplits) entries.push({ soft: sc.nm, sk: txt(nameOf.get(String(g.cid))?.sk), fr, row: base(String(g.cid), sc.nm, fr, sp) });
      for (const fr of fundraisersOf(sc.cid)) for (const sp of useSplits) entries.push({ soft: sc.nm, sk: txt(nameOf.get(sc.cid)?.sk), fr, row: base(sc.cid, sc.nm, fr, sp) });
    }
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const rows = entries
      .map((e, i) => ({ e, i }))
      .sort((a, b) => cmp(a.e.soft, b.e.soft) || cmp(a.e.sk, b.e.sk) || cmp(a.e.fr, b.e.fr) || a.i - b.i)
      .map((x) => x.e.row);
    return { id: recordId, lookup: giftID, date: g.d, donorId: String(g.cid), method: txt(g.pm), type: g.gtype, rows };
  });
}

/* ------------------------------------------------------------------ the post */

export interface PostGift {
  giftID: string;
  /** The line the post prints for this gift. */
  line: string;
  /** Where the gift counts: the post block it feeds, or "" for a gift that only adds to a total. */
  block: string;
  newPartner: boolean;
  director: string;
  consistent: boolean;
  recurring: boolean;
}
export interface PostResult {
  text: string;
  total: number;
  count: number;
  from: string;
  to: string;
  blocks: Array<{ name: string; total: number; entries: number }>;
  consistent: number;
  recurring: number;
  highlights: string[];
  gifts: PostGift[];
}

const stat = (): { total: number; entries: string[] } => ({ total: 0, entries: [] });

/** The Daily Revenue Reporter 4.2 output, line for line, including its own quirks (see b0-daily-post-format.md). */
export function buildPost(grid: GridGift[], hour: number): PostResult {
  const data: GridRow[] = [];
  const giftMap = new Map<string, number[]>();
  const order: string[] = [];
  let minDate = '9999-99-99';
  let maxDate = '';
  for (const g of grid) {
    for (const r of g.rows) {
      const i = data.push(r) - 1;
      if (!giftMap.has(r.giftID)) {
        giftMap.set(r.giftID, []);
        order.push(r.giftID);
      }
      giftMap.get(r.giftID)!.push(i);
      if (r.date < minDate) minDate = r.date;
      if (r.date > maxDate) maxDate = r.date;
    }
  }

  let givingTotal = 0;
  let consistentGiving = 0;
  let recurringGiving = 0;
  let totalGiftCt = 0;
  const parsedGiving: Record<string, { total: number; entries: string[] }> = {
    Website: stat(),
    'White Mail': stat(),
    'Direct Mail': stat(),
    'RDD Portfolio Giving': stat(),
    'Influenced Giving': stat(),
    Unidentified: stat(),
  };
  for (const k of Object.keys(OTHER_CATEGORIES)) parsedGiving[OTHER_CATEGORIES[k]] = stat();
  const rddHighlights: string[] = [];
  const out: PostGift[] = [];

  const getDirector = (row: GridRow): string => {
    if (row.fundraiser) return row.fundraiser;
    if (row.country === 'US' && row.fullAmount >= 1000) return STATE_DIRECTOR[row.state] || row.fundraiser || '_assignment not found_';
    if (row.country === 'AU' || row.country === 'NZ') return 'Celeste Paul';
    return 'Partner Care';
  };
  const catFinder = (appCat: string, appID: string): string => {
    switch (appCat) {
      case 'White Mail':
        return appID === 'Website' ? 'Website' : 'White Mail';
      case 'Direct Mail Appeal':
      case 'Direct Mail Newsletter':
      case 'Thank You Letter':
        return 'Direct Mail';
      default:
        return OTHER_CATEGORIES[appID?.charAt(0)] || 'Unidentified';
    }
  };
  const giftParser = (appCat: string, appID: string, amount: number): string => {
    const category = catFinder(appCat, appID);
    parsedGiving[category].total += amount;
    return category;
  };
  const getAppNfollowup = (category: string, director: string, dirCredit: boolean): string =>
    category === 'Other/Exception' ? '| Other/Exception - No follow-up' : category === director ? `- ${director}` : dirCredit ? `| ${category} - (follow-up: ${director})` : `| ${category} - ${director}`;
  const uniq = <T,>(arr: T[]): T[] => [...new Map(arr.map((o) => [JSON.stringify(o), o])).values()];
  const isNew = (r: GridRow) => r.firstGiftID === r.giftID || r.fullAmount === r.totalGiving;

  for (const giftID of order) {
    const indexes = giftMap.get(giftID)!;
    const first = data[indexes[0]];
    givingTotal += first.fullAmount;
    totalGiftCt++;

    if (indexes.length === 1) {
      const row = first;
      const pfCredit = row.appealCat.includes('Portfolio') && DIRECTORS.indexOf(row.fundraiser) > -1;
      const grants = row.appealCat === 'Grants Team';
      const dirCredit = row.appealCat.includes('Director') || grants;
      const newGiverText = isNew(row) ? ' (*New Partner*)' : '';
      const director = getDirector(row);
      const category = pfCredit ? row.fundraiser : grants ? 'Grants Team' : dirCredit ? row.appealCat.split(' - ')[1] : giftParser(row.appealCat, row.appealID, row.appealAmount);
      const partner = `${row.partner}${newGiverText}`;
      const appNfollowup = getAppNfollowup(category, director, dirCredit);
      const giftLine = `${money(row.fullAmount)} | ${partner} | ${row.fund} ${appNfollowup}`;
      let block = '';
      if (dirCredit) {
        parsedGiving['Influenced Giving'].entries.push(giftLine);
        parsedGiving['Influenced Giving'].total += row.appealAmount;
        block = 'Influenced Giving';
      } else if (pfCredit) {
        parsedGiving['RDD Portfolio Giving'].entries.push(giftLine);
        parsedGiving['RDD Portfolio Giving'].total += row.appealAmount;
        block = 'RDD Portfolio Giving';
      } else {
        block = category;
        if (newGiverText) parsedGiving[category].entries.push(giftLine);
      }
      if (row.fullAmount >= 1000) rddHighlights.push(giftLine);
      const cons = row.consistent.includes('Consistent') && !row.giftType.includes('Recurring');
      const rec = row.giftType.includes('Recurring');
      if (cons) consistentGiving += row.appealAmount;
      if (rec) recurringGiving += row.appealAmount;
      out.push({ giftID, line: giftLine, block, newPartner: !!newGiverText, director, consistent: cons, recurring: rec });
    } else {
      const splitFunds = new Set<string>();
      const splitApps = new Set<string>();
      const splitPartners: string[] = [];
      const softies = new Set<string>();
      const splitsRatio: number[] = [];
      const directors = new Set<string>();
      let splitSum = 0;
      let hasPfCredit = false;
      let hasDirCredit = false;
      let hasNewGiver = false;

      for (const i of indexes) {
        const row = data[i];
        const pfCredit = row.appealCat.includes('Portfolio') && DIRECTORS.indexOf(row.fundraiser) > -1;
        const grants = row.appealCat === 'Grants Team';
        const dirCredit = row.appealCat.includes('Director') || grants;
        const newGiverText = isNew(row) ? ' (*New Partner*)' : '';
        const partner = `${row.partner}${newGiverText}`;
        if (pfCredit) hasPfCredit = true;
        if (dirCredit) hasDirCredit = true;
        if (newGiverText) hasNewGiver = true;

        if (splitSum < first.fullAmount && (row.partner === row.softCredit || row.softCredit === '')) {
          const category = pfCredit ? row.fundraiser : grants ? 'Grants Team' : dirCredit ? row.appealCat.split(' - ')[1] : giftParser(row.appealCat, row.appealID, row.appealAmount);
          if (row.fund !== '') splitFunds.add(row.fund);
          splitApps.add(category);
          splitSum += row.appealAmount;
          if (row.appealAmount < first.fullAmount) splitsRatio.push(Math.round((row.appealAmount / first.fullAmount) * 100));
        } else if (splitSum > first.fullAmount) {
          break;
        }

        splitPartners.push(partner);
        let dir = '';
        if (row.partner === row.softCredit) {
          softies.add(partner);
          dir = getDirector(row);
        } else if (row.softCredit === '') {
          dir = getDirector(row);
        }
        if (dir !== '') directors.add(dir);
      }

      const cons = first.consistent.includes('Consistent') && !first.giftType.includes('Recurring');
      const rec = first.giftType.includes('Recurring');
      if (cons) consistentGiving += first.fullAmount;
      if (rec) recurringGiving += first.fullAmount;

      const hard = splitPartners.find((n) => !softies.has(n));
      const giverText = hard + (softies.size ? ` | ${[...softies].join(' & ')}` : '');
      const splitText = splitsRatio.length > 1 ? `Split ${splitsRatio.join('/')} | ` : '';
      const appText = [...splitApps].join(' & ');
      const dirsJoined = [...directors].join(' & ');
      const dirsText = appText === 'Other/Exception' ? 'No follow-up' : DIRECTORS.findIndex((rdd) => appText.includes(rdd)) >= 0 ? `(follow-up: ${dirsJoined})` : `${dirsJoined}`;
      const rowText = `${money(first.fullAmount)} | ${giverText} | ${splitText}${[...splitFunds].join(' & ')} | ${appText} - ${dirsText}`;
      const blocks: string[] = [];

      if (hasDirCredit) {
        const lines: Array<{ line: string; amount: number }> = [];
        for (const i of indexes) {
          const row = data[i];
          if ((row.appealCat.includes('Director') || row.appealCat === 'Grants Team') && (row.partner === row.softCredit || row.softCredit === '')) lines.push({ line: rowText, amount: row.fullAmount });
        }
        uniq(lines).forEach((e) => {
          parsedGiving['Influenced Giving'].entries.push(e.line);
          parsedGiving['Influenced Giving'].total += e.amount;
        });
        blocks.push('Influenced Giving');
      }
      if (hasPfCredit) {
        const lines: Array<{ line: string; amount: number }> = [];
        for (const i of indexes) {
          const row = data[i];
          if (row.appealCat.includes('Portfolio') && DIRECTORS.indexOf(row.fundraiser) > -1 && (row.partner === row.softCredit || row.softCredit === '')) lines.push({ line: rowText, amount: row.fullAmount });
        }
        uniq(lines).forEach((e) => {
          parsedGiving['RDD Portfolio Giving'].entries.push(e.line);
          parsedGiving['RDD Portfolio Giving'].total += e.amount;
        });
        blocks.push('RDD Portfolio Giving');
      }
      if (hasNewGiver) {
        const lines: Array<{ category: string; line: string }> = [];
        for (const i of indexes) {
          const row = data[i];
          if (isNew(row) && (row.partner === row.softCredit || row.softCredit === '')) lines.push({ category: catFinder(row.appealCat, row.appealID), line: rowText });
        }
        uniq(lines).forEach((e) => {
          const entries = parsedGiving[e.category].entries;
          if (entries.indexOf(e.line) < 0) entries.push(e.line);
        });
      }
      if (first.fullAmount >= 1000) rddHighlights.push(rowText);
      out.push({ giftID, line: rowText, block: blocks[0] || appText, newPartner: hasNewGiver, director: dirsJoined, consistent: cons, recurring: rec });
    }
  }

  const fmtRange = (a: string, b: string) => (a === b ? longDate(a) : `${longDate(a)} - ${longDate(b)}`);
  const greeting = hour >= 17 ? 'Evening' : hour >= 12 ? 'Afternoon' : 'Morning';
  let output = `Good ${greeting}, Team!


Please see the Daily Revenue Report for ${data.length ? fmtRange(minDate, maxDate) : '-'}.


Total received: ${money(givingTotal)} from ${totalGiftCt.toLocaleString('en-US')} gifts.


Please note, gifts of $1,000 and up, RDD portfolio gifts, and new partners will be highlighted. All other information will be in Blackbaud for specific review.`;

  const kept = Object.entries(parsedGiving).filter(([, v]) => v.total !== 0);
  const sorted = [...kept].sort(([, a], [, b]) => b.total - a.total);
  for (const [source, d] of sorted) {
    output += `


${source}: ${money(d.total)} ${d.entries.length ? `
* ${d.entries.join('\n* ').replaceAll('Influenced Giving', 'PC or Grant')}` : ''}`;
  }
  if (consistentGiving > 0) {
    output += `


Consistent Giving (included in total): ${money(consistentGiving)}`;
  }
  if (recurringGiving > 0) {
    output += `


Recurring Giving (included in total): ${money(recurringGiving)}`;
  }
  if (rddHighlights.length) {
    output += `


RDD Highlights (included in total):`;
    for (const line of rddHighlights) {
      output += `
* ${line}`;
    }
  }
  for (const key of Object.keys(ABBREVS)) output = output.replaceAll(ABBREVS[key], key);

  return {
    text: output,
    total: round2(givingTotal),
    count: totalGiftCt,
    from: data.length ? minDate : '',
    to: data.length ? maxDate : '',
    blocks: sorted.map(([name, v]) => ({ name, total: round2(v.total), entries: v.entries.length })),
    consistent: round2(consistentGiving),
    recurring: round2(recurringGiving),
    highlights: rddHighlights,
    gifts: out,
  };
}

/** The same shortening the post applies, for the table cells. */
export function shorten(s: string): string {
  let o = s;
  for (const key of Object.keys(ABBREVS)) o = o.replaceAll(ABBREVS[key], key);
  return o;
}
