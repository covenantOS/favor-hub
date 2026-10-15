// The Lists page's criteria as plain data, and the rules around them: the blank list, merging a saved list over it, setting one value by
// its path, how many criteria each section holds, and the base64url address form a report row uses to open a list. The server checks every
// value and compiles the query (functions/_lib/lists); nothing here writes SQL or recomputes a figure. Pure: no imports, so tests load it directly.

export type Kind = 'partners' | 'gifts';
export interface Range { min?: number | null; max?: number | null }
export interface Span { from?: string; to?: string }
export interface Period { from: string; to: string; min: number | null; max: number | null }

export interface PartnerSpec {
  status: string[];
  deceased: string;
  major: string;
  type: string;
  cameIn: string;
  firstCats: string[];
  holders: string[];
  holderTypes: string[];
  teams: string[];
  holder: string;
  states: string[];
  cities: string[];
  zips: string[];
  lifetime: Range;
  largest: Range;
  gifts: Range;
  giving: Period[];
  firstGift: Span;
  lastGift: Span;
  contactBefore: string;
  neverContacted: boolean;
  mailReady: boolean;
  solicitHas: string[];
  solicitNot: string[];
  codesHas: string[];
  codesNot: string[];
  attrsHas: string[];
  attrsNot: string[];
  relsHas: string[];
  eventsHas: string[];
}
export interface GiftSpec extends Range, Span {
  funds: string[];
  fundCats: string[];
  appeals: string[];
  appealCats: string[];
  kinds: string[];
  methods: string[];
  creditedTo: string[];
  soft: string;
}
export interface Sort { key: string; dir: 'asc' | 'desc' }
export interface ListSpec { kind: Kind; partner: PartnerSpec; gift: GiftSpec; columns: string[]; sort: Sort }

export function blank(kind?: string): ListSpec {
  return {
    kind: kind === 'gifts' ? 'gifts' : 'partners',
    partner: { status: [], deceased: 'exclude', major: 'any', type: 'any', cameIn: 'any', firstCats: [], holders: [], holderTypes: [], teams: [], holder: 'any', states: [], cities: [], zips: [], lifetime: {}, largest: {}, gifts: {}, giving: [], firstGift: {}, lastGift: {}, contactBefore: '', neverContacted: false, mailReady: false, solicitHas: [], solicitNot: [], codesHas: [], codesNot: [], attrsHas: [], attrsNot: [], relsHas: [], eventsHas: [] },
    gift: { from: '', to: '', min: null, max: null, funds: [], fundCats: [], appeals: [], appealCats: [], kinds: [], methods: [], creditedTo: [], soft: 'any' },
    columns: [],
    sort: { key: '', dir: 'desc' },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A copy of `into` with `from` laid over it: objects merge key by key, everything else (arrays, strings, numbers) is replaced. */
export function merge<T>(into: T, from: unknown): T {
  const out: Record<string, unknown> = { ...(into as Record<string, unknown>) };
  for (const [k, v] of Object.entries(isObj(from) ? from : {})) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  return out as T;
}

/** A saved list (or an address's spec) laid over the blank list of its kind, so a list saved before a criterion existed still opens. */
export const fromSaved = (spec: unknown): ListSpec => merge(blank(isObj(spec) ? String(spec.kind) : undefined), spec);

/** The value at a dotted path ('partner.lifetime.min'). */
export const getIn = (obj: unknown, path: string): any => path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), obj);

/** A copy with the value at a dotted path replaced; a numeric key steps into an array ('partner.giving.0.from'). */
export function setIn<T>(obj: T, path: string, value: unknown): T {
  const ks = path.split('.');
  const step = (o: any, i: number): any => {
    const k = ks[i];
    const copy: any = Array.isArray(o) ? o.slice() : { ...(o || {}) };
    copy[k] = i === ks.length - 1 ? value : step(o == null ? undefined : o[k], i + 1);
    return copy;
  };
  return step(obj, 0);
}

export const SECTIONS = ['status', 'held', 'place', 'giving', 'gifts', 'records'] as const;
export type SectionId = (typeof SECTIONS)[number];

/** How many criteria are set in each section (the number beside its title) and in all of them. */
export function sectionCounts(spec: ListSpec): Record<SectionId, number> & { total: number } {
  const p = spec.partner;
  const g = spec.gift;
  const rg = (r: Range | undefined) => (r && (r.min != null || r.max != null) ? 1 : 0);
  const sp = (r: Span | undefined) => (r && (r.from || r.to) ? 1 : 0);
  const n = (b: boolean) => (b ? 1 : 0);
  const c = {
    status: p.status.length + n(p.major !== 'any') + n(p.type !== 'any') + n(p.cameIn !== 'any') + p.firstCats.length + n(p.deceased !== 'exclude'),
    held: p.holders.length + p.teams.length + p.holderTypes.length + n(p.holder !== 'any'),
    place: p.states.length + p.cities.length + p.zips.length,
    giving: rg(p.lifetime) + rg(p.largest) + rg(p.gifts) + p.giving.length + sp(p.firstGift) + sp(p.lastGift),
    gifts: sp(g) + rg(g) + g.funds.length + g.fundCats.length + g.appeals.length + g.appealCats.length + g.kinds.length + g.methods.length + g.creditedTo.length + n(g.soft !== 'any'),
    records: p.solicitHas.length + p.solicitNot.length + p.codesHas.length + p.codesNot.length + p.attrsHas.length + p.relsHas.length + p.eventsHas.length + n(!!p.contactBefore) + n(p.neverContacted) + n(p.mailReady),
  };
  return { ...c, total: c.status + c.held + c.place + c.giving + c.gifts + c.records };
}

/** What a typed amount means: '$1,200' is 1200, '' and words are no limit. */
export function parseAmount(text: string): number | null {
  const v = text.replace(/[$,\s]/g, '');
  return v === '' || Number.isNaN(Number(v)) ? null : Number(v);
}

/** A comma list typed into a box: 'Tampa, Austin' is ['Tampa', 'Austin']. */
export const parseList = (text: string): string[] => text.split(',').map((x) => x.trim()).filter(Boolean);

/** A spec in an address (/lists/?spec=...): base64url of its JSON, in UTF-8. */
export function encodeSpec(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeSpec(s: string): unknown {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** The big number's unit under the count: partner or gift, singular for one. */
export const unitWord = (kind: Kind, n: number): string => (kind === 'gifts' ? (n === 1 ? 'gift' : 'gifts') : n === 1 ? 'partner' : 'partners');
