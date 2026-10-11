// Giving statements: which gifts belong on a partner's statement, and how they add up.
//
// Read from the Blackbaud copy (the mirror), never from Blackbaud's Giving Statements screen. The rules come from
// the records and the rulebook (Technology Handoff, Rulebook):
//   - The giver of record is the legal donor, so a statement lists the gifts that sit on the partner's own record.
//     A fund, brokerage or foundation that passes money along for a partner is the legal donor; the partner it is
//     soft-credited to sees those gifts in a separate section that never counts toward the tax total.
//   - Recurring gift setups are schedules, not money. Their payments are gifts and read "Monthly".
//   - A payment recorded at $0 is a declined card. A declined card recorded with an amount (reference starts with
//     HardReject or SoftReject) stays off and shows in the preview for a person to settle (Rulebook open item 11).
//   - A negative amount is a refund. It shows on its own line and reduces the net total.
//   - A gift to a fund whose name starts "Non Tax Deductible", or to an appeal in the Book category, is listed apart
//     and does not count toward the tax total.
//   - A stock or in-kind gift (the reference says so) counts, carries a marker and the non-cash note.
// Every figure is kept in cents so a partner's lines add up to the total on the page exactly.

export interface RawSplit {
  cents: number;
  fundId: string;
  appealId: string;
}

export interface RawGift {
  /** Blackbaud system id. */
  id: string;
  /** The Gift ID staff see. */
  lookup: string;
  giverId: string;
  giverName: string;
  /** YYYY-MM-DD */
  date: string;
  cents: number;
  type: string;
  status: string;
  method: string;
  reference: string;
  anonymous: boolean;
  splits: RawSplit[];
  soft: Array<{ id: string; cents: number }>;
}

export interface Names {
  fund(id: string): string;
  appealCategory(id: string): string;
}

export type SectionKey = 'gifts' | 'notDeductible' | 'soft' | 'refunds';
export type LeftKey = 'schedule' | 'status' | 'zero' | 'declined' | 'soft_hidden' | 'other';

export interface Line {
  giftId: string;
  lookup: string;
  date: string;
  cents: number;
  /** One-time, Monthly or Other. */
  kind: 'One-time' | 'Monthly' | 'Other';
  fund: string;
  /** noncash: stock or in-kind. split: the gift has a part in another section. */
  flags: string[];
  /** Soft section: the record that gave. */
  from?: string;
  section: SectionKey;
}

export interface LeftOff {
  giftId: string;
  lookup: string;
  date: string;
  cents: number;
  reason: LeftKey;
}

export const LEFT_TEXT: Record<LeftKey, string> = {
  schedule: 'Monthly gift schedule (the payments are listed instead)',
  status: 'Gift status is not Active or Completed',
  zero: 'Declined payment recorded at $0',
  declined: 'Declined card recorded with an amount (needs a person to settle it)',
  soft_hidden: 'Given by another record and soft-credited to this partner',
  other: 'Not on this partner',
};

const GOOD_STATUS = ['active', 'completed'];
const DECLINED = /^\s*(hard|soft)\s*reject/i;
const NONCASH = /\b(stock|shares?|securities|in[- ]?kind|non[- ]?cash|property|vehicle)\b/i;
const NOT_DEDUCTIBLE_FUND = /^\s*non[- ]?tax[- ]?deductible/i;
const GOODS_APPEAL_CATEGORIES = ['book'];

export interface Options {
  /** List the gifts other records gave and soft-credited to this partner. */
  includeSoft: boolean;
}

export const cents = (dollars: unknown): number => Math.round((Number(dollars) || 0) * 100);
export const dollars = (c: number): number => Math.round(c) / 100;

export function kindOf(type: string): Line['kind'] {
  if (type === 'RecurringGiftPayment') return 'Monthly';
  if (type === 'Donation') return 'One-time';
  return 'Other';
}

export function isDeclinedNote(reference: string): boolean {
  return DECLINED.test(reference || '');
}

export function isNoncash(reference: string): boolean {
  return NONCASH.test(reference || '');
}

/** True when a split goes to a fund or appeal that is not a tax-deductible contribution. */
export function splitNotDeductible(s: RawSplit, names: Names): boolean {
  if (NOT_DEDUCTIBLE_FUND.test(names.fund(s.fundId) || '')) return true;
  const cat = (names.appealCategory(s.appealId) || '').trim().toLowerCase();
  return GOODS_APPEAL_CATEGORIES.includes(cat);
}

const fundText = (splits: RawSplit[], names: Names): string => {
  const out: string[] = [];
  for (const s of splits) {
    const f = (names.fund(s.fundId) || '').trim();
    if (f && !out.includes(f)) out.push(f);
  }
  return out.join('; ');
};

export interface Classified {
  lines: Line[];
  left?: LeftOff;
}

/** Where one gift goes on one partner's statement. */
export function classify(g: RawGift, partnerId: string, names: Names, opt: Options): Classified {
  const base = { giftId: g.id, lookup: g.lookup, date: g.date };
  const left = (reason: LeftKey, c = g.cents): Classified => ({ lines: [], left: { ...base, cents: c, reason } });
  if (g.type === 'RecurringGift') return left('schedule');
  if (!GOOD_STATUS.includes((g.status || '').toLowerCase())) return left('status');
  const isGiver = g.giverId === partnerId;
  const softMine = g.soft.filter((s) => s.id === partnerId).reduce((t, s) => t + s.cents, 0);
  const isSoft = !isGiver && g.soft.some((s) => s.id === partnerId);
  if (!isGiver && !isSoft) return left('other');
  const kind = kindOf(g.type);
  const flags: string[] = [];
  if (isNoncash(g.reference)) flags.push('noncash');

  if (isSoft) {
    if (g.cents <= 0 || isDeclinedNote(g.reference)) return left(g.cents === 0 ? 'zero' : 'declined');
    if (!opt.includeSoft) return left('soft_hidden', softMine || g.cents);
    return { lines: [{ ...base, cents: softMine || g.cents, kind, fund: fundText(g.splits, names), flags, from: g.giverName, section: 'soft' }] };
  }

  if (g.cents === 0) return left('zero');
  if (g.cents < 0) return { lines: [{ ...base, cents: g.cents, kind, fund: fundText(g.splits, names), flags, section: 'refunds' }] };
  if (isDeclinedNote(g.reference)) return left('declined');

  // Split by what each part goes to. A gift with no usable splits is one line.
  const sum = g.splits.reduce((t, s) => t + s.cents, 0);
  const usable = g.splits.length > 0 && sum === g.cents;
  if (!usable) {
    const bad = g.splits.length > 0 && g.splits.every((s) => splitNotDeductible(s, names));
    return { lines: [{ ...base, cents: g.cents, kind, fund: fundText(g.splits, names), flags, section: bad ? 'notDeductible' : 'gifts' }] };
  }
  const ded = g.splits.filter((s) => !splitNotDeductible(s, names));
  const non = g.splits.filter((s) => splitNotDeductible(s, names));
  const lines: Line[] = [];
  const split = ded.length > 0 && non.length > 0;
  if (ded.length) lines.push({ ...base, cents: ded.reduce((t, s) => t + s.cents, 0), kind, fund: fundText(ded, names), flags: split ? [...flags, 'split'] : flags, section: 'gifts' });
  if (non.length) lines.push({ ...base, cents: non.reduce((t, s) => t + s.cents, 0), kind, fund: fundText(non, names), flags: split ? [...flags, 'split'] : flags, section: 'notDeductible' });
  return { lines };
}

export interface PartnerInfo {
  id: string;
  lookup: string;
  name: string;
  addressee: string;
  sortName: string;
  organization: boolean;
  addressLines: string[];
  city: string;
  state: string;
  zip: string;
  country: string;
  email: string;
  constituency: string[];
}

export interface Statement {
  partner: PartnerInfo;
  from: string;
  to: string;
  gifts: Line[];
  notDeductible: Line[];
  soft: Line[];
  refunds: Line[];
  left: LeftOff[];
  /** Cents. */
  totals: {
    gifts: number;
    giftCount: number;
    notDeductible: number;
    soft: number;
    refunds: number;
    /** gifts + refunds */
    net: number;
    /** Every positive amount on the partner's own record, setups aside: the figure the tax lists add up. */
    taxBasis: number;
  };
  byFund: Array<{ fund: string; cents: number }>;
  /** Plain facts a person should look at before printing. */
  notes: string[];
}

const byDate = (a: { date: string; giftId: string }, b: { date: string; giftId: string }) => a.date.localeCompare(b.date) || a.giftId.localeCompare(b.giftId, 'en', { numeric: true });

export function composeStatement(partner: PartnerInfo, gifts: RawGift[], from: string, to: string, names: Names, opt: Options): Statement {
  const inRange = gifts.filter((g) => g.date >= from && g.date <= to);
  const out: Statement = {
    partner,
    from,
    to,
    gifts: [],
    notDeductible: [],
    soft: [],
    refunds: [],
    left: [],
    totals: { gifts: 0, giftCount: 0, notDeductible: 0, soft: 0, refunds: 0, net: 0, taxBasis: 0 },
    byFund: [],
    notes: [],
  };
  const seen = new Set<string>();
  for (const g of inRange) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    if (g.giverId === partner.id && g.type !== 'RecurringGift' && g.cents > 0) out.totals.taxBasis += g.cents;
    const c = classify(g, partner.id, names, opt);
    for (const l of c.lines) out[l.section].push(l);
    if (c.left) out.left.push(c.left);
  }
  for (const k of ['gifts', 'notDeductible', 'soft', 'refunds'] as const) out[k].sort(byDate);
  out.left.sort(byDate);
  out.totals.gifts = out.gifts.reduce((t, l) => t + l.cents, 0);
  out.totals.giftCount = new Set(out.gifts.map((l) => l.giftId)).size;
  out.totals.notDeductible = out.notDeductible.reduce((t, l) => t + l.cents, 0);
  out.totals.soft = out.soft.reduce((t, l) => t + l.cents, 0);
  out.totals.refunds = out.refunds.reduce((t, l) => t + l.cents, 0);
  out.totals.net = out.totals.gifts + out.totals.refunds;
  const funds = new Map<string, number>();
  for (const l of out.gifts) funds.set(l.fund || 'Where Needed Most', (funds.get(l.fund || 'Where Needed Most') || 0) + l.cents);
  out.byFund = [...funds.entries()].map(([fund, c]) => ({ fund, cents: c })).sort((a, b) => b.cents - a.cents || a.fund.localeCompare(b.fund));
  const n = (k: LeftKey) => out.left.filter((l) => l.reason === k).length;
  if (n('declined')) out.notes.push(`${n('declined')} declined card recorded with an amount is left off. Settle it in Blackbaud before this statement goes out.`);
  if (out.gifts.some((l) => l.flags.includes('noncash'))) out.notes.push('A stock or in-kind gift is on the list. The non-cash note prints under it.');
  if (out.gifts.some((l) => l.flags.includes('split'))) out.notes.push('A gift with a part in a non-deductible fund is shown in two lines.');
  if (out.refunds.length) out.notes.push(out.refunds.length === 1 ? '1 refund reduces the net total.' : `${out.refunds.length} refunds reduce the net total.`);
  if (n('soft_hidden')) out.notes.push(`${n('soft_hidden')} gift${n('soft_hidden') === 1 ? '' : 's'} given through another record and soft-credited to this partner ${n('soft_hidden') === 1 ? 'is' : 'are'} not shown. Turn on the soft credit section to list them.`);
  return out;
}

/* ------------------------------------------------------------------------------------------ dates and money */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

export function moneyOf(c: number): string {
  const neg = c < 0;
  const v = Math.abs(c) / 100;
  return `${neg ? '-' : ''}$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2025" for a whole calendar year, else "March 1, 2026 to June 30, 2026". */
export function periodLabel(from: string, to: string): string {
  if (from.slice(5) === '01-01' && to.slice(5) === '12-31' && from.slice(0, 4) === to.slice(0, 4)) return from.slice(0, 4);
  return `${longDate(from)} to ${longDate(to)}`;
}

export function validDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
}

/** A person's range: a year, or from and to. Throws a plain sentence for a bad one. */
export function rangeOf(year: string, from: string, to: string): { from: string; to: string } {
  if (from || to) {
    if (!validDay(from) || !validDay(to)) throw new Error('Give both dates as YYYY-MM-DD.');
    if (to < from) throw new Error('The end date is before the start date.');
    return { from, to };
  }
  if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) throw new Error('Pick a year or give both dates.');
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Street and five-digit ZIP, punctuation out, so two records at one address print together. */
export function addressKeyOf(lines: string[], zip: string): string {
  return lines.length ? `${lines.join(' ').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(zip || '').slice(0, 5)}` : '';
}
