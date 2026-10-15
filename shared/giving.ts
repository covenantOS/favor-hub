// Partner giving, defined once for every FavorOS page, the server and the app.
//
// The rule is the KPI dashboard's (re-nxt-cloud-sync src/kpi-builders/donor-kpis.js) and the Favor Brain's (favor-mcp src/data/credit.ts):
//   1. A gift counts when it is over $0, dated, and is not a RecurringGift schedule. The payments on a schedule count.
//   2. A gift with soft credits counts for the partners it names, never for the record it sits on. A gift sent through a donor-advised fund
//      (National Christian Foundation, Fidelity Charitable), a foundation or a business counts for the person named on it, once.
//   3. Spouses linked in Blackbaud are one household. A household never gets more than the gift amount from one gift.
//   4. Active: a gift in the last 12 months. LYBUNT: the last gift was 12 to 24 months ago. Lapsed: the last gift was more than 24 months ago.
//   5. Major partner: one gift of $1,000 or more at any time (the gift that moves a partner from Partner Care to an RDD).
//
// The pure parts live here so the tie-out scripts and the tests run the same code the pages do. The mirror reads are in
// functions/_lib/giving/partner.ts. The words staff see for each term are in TERMS and nowhere else; public/js/favor-ui.js carries a copy
// that tests/giving.test.mjs keeps equal.

export const MAJOR_GIFT_MIN = 1000;

/** The plain meaning of each term a page may show, used for tooltips and the help page. */
export const TERMS: Record<string, { label: string; tip: string }> = {
  lifetime: {
    label: 'Lifetime giving',
    tip: 'Every gift credited to this partner and their spouse: their own gifts plus gifts sent through a donor-advised fund, foundation or business that name them. A gift counts once, for the partner it names.',
  },
  soft: {
    label: 'Soft credit',
    tip: 'Someone else’s record sent the money, usually a donor-advised fund, foundation or business, and named this partner as the giver. FavorOS counts the gift for the partner it names, not for the record that sent it.',
  },
  daf: {
    label: 'DAF',
    tip: 'Donor-advised fund. A charity account such as National Christian Foundation or Fidelity Charitable that a partner gives through. The gift is on the fund’s record and soft-credited to the partner.',
  },
  household: {
    label: 'Household',
    tip: 'A partner and the spouse linked to them in Blackbaud count as one household. A gift either of them gives counts once for both.',
  },
  active: { label: 'Active', tip: 'Gave in the last 12 months.' },
  lybunt: { label: 'LYBUNT', tip: 'Last year but not this year: the last gift was 12 to 24 months ago and nothing has come in the 12 months since.' },
  lapsed: { label: 'Lapsed', tip: 'The last gift was more than 24 months ago.' },
  major: { label: 'Major partner', tip: 'Has given one gift of $1,000 or more at some point. The same gift moves a partner from Partner Care to a Regional Development Director.' },
  passedOn: {
    label: 'Passed on',
    tip: 'Gifts this record sent for other partners, such as a donor-advised fund granting for a family. They count for the partners named on them, so they are not this record’s own giving.',
  },
  recurring: { label: 'Recurring', tip: 'A payment on a recurring gift schedule. The schedule itself is not a gift; each payment is.' },
  other: { label: 'Other', tip: 'Blackbaud recorded the payment type as Other. Most are donor-advised fund grants, wires and online gifts Blackbaud has no closer name for.' },
};

/** $1,234 for whole dollars, $1,234.50 when there are cents. Negative amounts keep their sign. */
export function money(n: number): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const cents = Math.round(a * 100) % 100 !== 0;
  return (v < 0 ? '-' : '') + '$' + a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

/** Whole dollars for totals ($76,500); single gifts use money() and keep their cents. */
export function whole(n: number): string {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US');
}

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Oct 13, 2026 from YYYY-MM-DD (the date as Blackbaud stores it, no time zone shift). */
export function giftDay(ymd: string): string {
  const d = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------- the credit rule over rows

export interface GiftRow {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  type: string;
  /** The record the gift sits on. */
  giver: string;
  /** Raw gifts.soft_credits JSON, or null. */
  soft: string | null;
}

export interface SoftEntry {
  cid: string;
  /** null when Blackbaud left the amount off; the full gift then counts (the KPI builder's COALESCE). */
  amount: number | null;
}

export function softOf(raw: unknown): SoftEntry[] {
  if (raw == null || raw === '' || raw === '[]') return [];
  try {
    const v = JSON.parse(String(raw));
    if (!Array.isArray(v)) return [];
    return v
      .map((s: any) => {
        const raw = s?.amount && typeof s.amount === 'object' ? s.amount.value : s?.amount;
        return { cid: String(s?.constituent_id ?? ''), amount: raw == null || raw === '' ? null : Number(raw) || 0 };
      })
      .filter((s) => s.cid);
  } catch {
    return [];
  }
}

/** Rule 1: does the gift count at all. */
export const counts = (g: Pick<GiftRow, 'amount' | 'date' | 'type'>): boolean => Number(g.amount) > 0 && !!g.date && g.type !== 'RecurringGift';

/**
 * What one gift credits to one household (members = the household's record ids). Rules 2 and 3.
 * Returns 0 when the gift counts for someone else. A soft credit entry with no amount gives the full gift.
 */
export function creditTo(g: GiftRow, members: Set<string>): number {
  if (!counts(g)) return 0;
  const soft = softOf(g.soft);
  if (!soft.length) return members.has(String(g.giver)) ? Number(g.amount) : 0;
  const mine = soft.filter((s) => members.has(s.cid));
  if (!mine.length) return 0;
  const sum = mine.reduce((t, s) => t + (s.amount ?? Number(g.amount)), 0);
  return Math.min(Number(g.amount), sum);
}

/** Gifts on one of the household's records that count for other partners (a DAF granting for a family). */
export const passedOn = (g: GiftRow, members: Set<string>): boolean => counts(g) && members.has(String(g.giver)) && softOf(g.soft).some((s) => !members.has(s.cid));

export type Status = 'active' | 'lybunt' | 'lapsed' | 'none';

/** YYYY-MM-DD shifted by whole months (SQLite's date(x, '-12 months') overflow, as the KPI builder does). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

export function statusOf(lastDate: string | null, asOf: string): Status {
  if (!lastDate) return 'none';
  if (lastDate > addMonths(asOf, -12)) return 'active';
  if (lastDate > addMonths(asOf, -24)) return 'lybunt';
  return 'lapsed';
}

export const STATUS_WORD: Record<Status, string> = { active: 'Active', lybunt: 'LYBUNT', lapsed: 'Lapsed', none: 'No gifts yet' };

export interface Through {
  id: string;
  name: string;
  /** 'daf' | 'foundation' | 'business' | 'church' | 'organization' | 'person' */
  kind: string;
  total: number;
  count: number;
}

export interface Giving {
  /** The household's credited giving under the rule above. */
  total: number;
  count: number;
  /** Credited gifts on the household's own records with no soft credit. */
  own: { total: number; count: number };
  /** Credited gifts sent from another record and soft-credited to the household, largest first. */
  through: Through[];
  /** Gifts on the household's records that count for other partners. */
  passedOn: { total: number; count: number; partners: number };
  first: string | null;
  last: { amount: number; date: string; through: string } | null;
  largest: { amount: number; date: string } | null;
  ytd: number;
  last12: number;
  years: { year: string; total: number; count: number; own: number; through: number }[];
  status: Status;
  major: boolean;
  asOf: string;
  /** Every credited gift, newest first: the amount credited, the gift's full amount, the record it sits on, and the record it came through (soft credit). */
  gifts: { id: string; date: string; amount: number; gift: number; giver: string; via: string }[];
  /** Gifts on the household's records that count for other partners, newest first (at most 50). */
  passedOnGifts: { id: string; date: string; amount: number; partners: string[] }[];
}

/**
 * The household's giving from its gift rows. rows = every gift that sits on a member's record or names a member in its soft credits.
 * names maps a giving record id to its name and kind, for the "through" lines.
 */
export function givingOf(rows: GiftRow[], members: Set<string>, names: Map<string, { name: string; kind: string }>, asOf: string): Giving {
  const seen = new Set<string>();
  const credited: { g: GiftRow; a: number; via: string }[] = [];
  let poTotal = 0;
  let poCount = 0;
  const poPartners = new Set<string>();
  const poGifts: Giving['passedOnGifts'] = [];
  for (const g of rows) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    const a = creditTo(g, members);
    if (a > 0) {
      const via = softOf(g.soft).length && !members.has(String(g.giver)) ? String(g.giver) : '';
      credited.push({ g, a, via });
    }
    if (passedOn(g, members) && g.date <= asOf) {
      poCount += 1;
      const others = softOf(g.soft).filter((s) => !members.has(s.cid));
      const theirs = others.reduce((t, s) => t + (s.amount ?? Number(g.amount)), 0);
      const amt = Math.min(Number(g.amount), theirs);
      poTotal += amt;
      for (const s of others) poPartners.add(s.cid);
      poGifts.push({ id: g.id, date: g.date, amount: Math.round(amt * 100) / 100, partners: [...new Set(others.map((o) => o.cid))] });
    }
  }
  credited.sort((x, y) => (x.g.date < y.g.date ? -1 : x.g.date > y.g.date ? 1 : 0));
  const yearStart = asOf.slice(0, 4) + '-01-01';
  const t12 = addMonths(asOf, -12);
  const viaMap = new Map<string, Through>();
  const years = new Map<string, { year: string; total: number; count: number; own: number; through: number }>();
  let total = 0;
  let ownT = 0;
  let ownN = 0;
  let ytd = 0;
  let last12 = 0;
  let largest: Giving['largest'] = null;
  for (const c of credited) {
    if (c.g.date > asOf) continue;
    total += c.a;
    if (c.via) {
      const n = names.get(c.via) || { name: `Record ${c.via}`, kind: 'organization' };
      const t = viaMap.get(c.via) || { id: c.via, name: n.name, kind: n.kind, total: 0, count: 0 };
      t.total += c.a;
      t.count += 1;
      viaMap.set(c.via, t);
    } else {
      ownT += c.a;
      ownN += 1;
    }
    if (c.g.date >= yearStart) ytd += c.a;
    if (c.g.date > t12) last12 += c.a;
    if (!largest || c.a > largest.amount || (c.a === largest.amount && c.g.date > largest.date)) largest = { amount: c.a, date: c.g.date };
    const y = c.g.date.slice(0, 4);
    const row = years.get(y) || { year: y, total: 0, count: 0, own: 0, through: 0 };
    row.total += c.a;
    row.count += 1;
    if (c.via) row.through += c.a;
    else row.own += c.a;
    years.set(y, row);
  }
  const inRange = credited.filter((c) => c.g.date <= asOf);
  const lastC = inRange[inRange.length - 1];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    total: r2(total),
    count: inRange.length,
    own: { total: r2(ownT), count: ownN },
    through: [...viaMap.values()].map((t) => ({ ...t, total: r2(t.total) })).sort((a, b) => b.total - a.total),
    passedOn: { total: r2(poTotal), count: poCount, partners: poPartners.size },
    first: inRange[0]?.g.date || null,
    last: lastC ? { amount: r2(lastC.a), date: lastC.g.date, through: lastC.via ? names.get(lastC.via)?.name || '' : '' } : null,
    largest,
    ytd: r2(ytd),
    last12: r2(last12),
    years: [...years.values()].map((y) => ({ ...y, total: r2(y.total), own: r2(y.own), through: r2(y.through) })).sort((a, b) => (a.year < b.year ? 1 : -1)),
    status: statusOf(lastC?.g.date || null, asOf),
    major: !!largest && largest.amount >= MAJOR_GIFT_MIN,
    asOf,
    gifts: inRange
      .slice()
      .reverse()
      .map((c) => ({ id: c.g.id, date: c.g.date, amount: r2(c.a), gift: Number(c.g.amount), giver: String(c.g.giver), via: c.via })),
    passedOnGifts: poGifts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 50),
  };
}

// ---------------------------------------------------------------- the words

const KIND_WORD: Record<string, string> = { daf: 'DAF', foundation: 'foundation', business: 'business', church: 'church', organization: '', person: '' };

/** "National Christian Foundation (DAF)". */
export function throughName(t: Pick<Through, 'name' | 'kind'>): string {
  const w = KIND_WORD[t.kind] || '';
  return w && !t.name.toLowerCase().includes(w.toLowerCase()) ? `${t.name} (${w})` : t.name;
}

/** "$76,500 in 43 gifts". Never "No gifts on record" when anything is credited. */
export function lifetimeLine(g: Pick<Giving, 'total' | 'count' | 'passedOn'>): string {
  if (g.count > 0) return `${whole(g.total)} in ${plural(g.count, 'gift')}`;
  if (g.passedOn.count > 0) return 'None of its own (it passes gifts on for others)';
  return 'No gifts yet';
}

/** How the lifetime figure came in: "All through National Christian Foundation (DAF)", or a split. Empty when every gift is their own. */
export function sourceLine(g: Pick<Giving, 'own' | 'through' | 'count'>): string {
  if (!g.count || !g.through.length) return '';
  const parts = g.through.slice(0, 2).map((t) => `${whole(t.total)} through ${throughName(t)}`);
  const more = g.through.length - 2;
  if (more > 0) parts.push(`${whole(g.through.slice(2).reduce((s, t) => s + t.total, 0))} through ${plural(more, 'other')}`);
  if (!g.own.count && g.through.length === 1) return `All through ${throughName(g.through[0])}`;
  if (g.own.count) parts.unshift(`${whole(g.own.total)} given directly`);
  return parts.join(', ');
}

/** "$1,000 on Oct 13, 2026 through National Christian Foundation". */
export function lastGiftLine(g: Pick<Giving, 'last'>): string {
  if (!g.last) return '';
  return `${money(g.last.amount)} on ${giftDay(g.last.date)}${g.last.through ? ` through ${g.last.through}` : ''}`;
}

/** "$25,041,354 in 1,431 gifts for 312 partners". */
export function passedOnLine(g: Pick<Giving, 'passedOn'>): string {
  const p = g.passedOn;
  if (!p.count) return '';
  return `${whole(p.total)} in ${plural(p.count, 'gift')} for ${plural(p.partners, 'partner')}`;
}

/** The kind of a giving record from its constituent codes (or the gift constituency) and whether it is an organization. */
export function kindOf(codes: string[], isOrg: boolean): string {
  const c = codes.map((x) => String(x || '').toLowerCase());
  if (c.some((x) => x === 'daf provider' || x === 'donor advised fund')) return 'daf';
  if (c.includes('foundation')) return 'foundation';
  if (c.includes('business')) return 'business';
  if (c.includes('church')) return 'church';
  return isOrg ? 'organization' : 'person';
}
