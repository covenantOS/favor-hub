// Add a partner from Entry: the duplicate check. Pure. Candidates arrive as plain rows read from the mirror and from Blackbaud's own
// duplicate search; this file decides which are worth showing and says why, in the words Support reads.
//
// Rules (memory d1-mirror-keeps-deleted-rows): an organization is never matched on its name alone. It needs the same phone, the same
// web domain, or the same city beside the name. The mirror keeps merged and deleted records, so when Blackbaud's live search ran and did
// not return a record the mirror matched on name alone, that record is dropped.
import { digits, norm } from './intake';

export type Kind = 'individual' | 'household' | 'organization';

export interface Probe {
  kind: Kind;
  first: string;
  last: string;
  spouseFirst: string;
  spouseLast: string;
  org: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  zip: string;
}

export interface Cand {
  cid: string;
  lookup: string;
  type: string; // Individual | Organization
  first: string;
  last: string;
  org: string;
  city: string;
  state: string;
  zip: string;
  phones: string[]; // digits, last ten
  emails: string[]; // lower case
  deceased: boolean;
  inactive: boolean;
  since: string; // YYYY-MM-DD the record was added
  gifts: number;
  lastGift: string; // YYYY-MM-DD or ''
  lastAmount: number;
  holders: string[];
}

export interface Match {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  email: string;
  phone: string;
  since: string;
  gifts: number;
  lastGift: string;
  lastAmount: number;
  holders: string[];
  deceased: boolean;
  reasons: string[];
  weight: number;
  live: boolean; // Blackbaud's own search returned it
  fromCopy: boolean; // the mirror returned it
}

const FREE = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'msn.com', 'live.com', 'comcast.net', 'me.com', 'att.net', 'sbcglobal.net', 'verizon.net', 'bellsouth.net', 'cox.net', 'protonmail.com', 'ymail.com', 'mac.com']);

export const domainOf = (email: string): string => {
  const d = String(email || '').toLowerCase().split('@')[1] || '';
  return d && !FREE.has(d) ? d : '';
};

const NICK: Record<string, string> = {
  will: 'william', bill: 'william', billy: 'william', bob: 'robert', rob: 'robert', bobby: 'robert', jim: 'james', jimmy: 'james', tom: 'thomas', tommy: 'thomas',
  tim: 'timothy', mike: 'michael', dave: 'david', rick: 'richard', rich: 'richard', dick: 'richard', chris: 'christopher', kate: 'katherine', kathy: 'katherine',
  liz: 'elizabeth', beth: 'elizabeth', jen: 'jennifer', jenny: 'jennifer', steve: 'steven', stephen: 'steven', joe: 'joseph', dan: 'daniel', danny: 'daniel',
  ed: 'edward', ted: 'edward', ben: 'benjamin', sam: 'samuel', matt: 'matthew', tony: 'anthony', andy: 'andrew', drew: 'andrew', pat: 'patricia', sue: 'susan',
  jack: 'john', johnny: 'john', jon: 'john', nick: 'nicholas', greg: 'gregory', jeff: 'jeffrey', ken: 'kenneth', larry: 'lawrence', ron: 'ronald', don: 'donald',
  doug: 'douglas', gene: 'eugene', peggy: 'margaret', maggie: 'margaret', meg: 'margaret', debbie: 'deborah', deb: 'deborah', barb: 'barbara', cindy: 'cynthia',
};
const canon = (f: string) => {
  const n = norm(f).split(' ')[0] || '';
  return NICK[n] || n;
};
export const sameFirst = (a: string, b: string): boolean => {
  const x = canon(a);
  const y = canon(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x)));
};

const nm = (s: string) => norm(s);
const sameCity = (a: string, b: string) => !!nm(a) && nm(a) === nm(b);

interface Who {
  first: string;
  last: string;
}

function personReasons(who: Who, p: Probe, c: Cand): string[] {
  if (c.type === 'Organization') return [];
  const r: string[] = [];
  if (!nm(who.last) || nm(c.last) !== nm(who.last)) return r;
  const first = sameFirst(who.first, c.first);
  const city = sameCity(p.city, c.city);
  if (first && city) r.push('Same name and city');
  else if (first) r.push('Same name');
  else if (city) r.push('Same last name and city');
  return r;
}

/** The reasons a candidate record may be the same partner as the probe, strongest first. Empty when it is not worth showing. */
export function reasonsFor(p: Probe, c: Cand): string[] {
  const r: string[] = [];
  const ph = digits(p.phone);
  if (ph && c.phones.includes(ph)) r.push('Same phone');
  const em = String(p.email || '').trim().toLowerCase();
  if (em && c.emails.includes(em)) r.push('Same email');
  if (p.kind === 'organization') {
    const dom = domainOf(p.email);
    const nameEq = !!nm(p.org) && c.type === 'Organization' && nm(c.org) === nm(p.org);
    if (dom && c.emails.some((e) => domainOf(e) === dom)) r.push('Same web domain');
    if (nameEq && sameCity(p.city, c.city)) r.push('Same name and city');
    // An organization is never matched on its name alone.
    return r;
  }
  const people: Who[] = [{ first: p.first, last: p.last }];
  if (p.kind === 'household' && (p.spouseFirst || p.spouseLast)) people.push({ first: p.spouseFirst, last: p.spouseLast || p.last });
  const names: string[] = [];
  for (const w of people) for (const x of personReasons(w, p, c)) if (!names.includes(x)) names.push(x);
  // Only the strongest name reason is shown.
  for (const x of ['Same name and city', 'Same name', 'Same last name and city']) if (names.includes(x)) { r.push(x); break; }
  return r;
}

const WEIGHT: Record<string, number> = { 'Same phone': 100, 'Same email': 100, 'Same name and city': 80, 'Same web domain': 60, 'Same name': 50, 'Same last name and city': 40, 'Name match in Blackbaud': 45 };
const NAME_ONLY = new Set(['Same name', 'Same last name and city', 'Same name and city', 'Name match in Blackbaud']);

const displayName = (c: Cand) => (c.type === 'Organization' ? c.org : `${c.first} ${c.last}`.trim()) || '(no name)';

/** Rank the mirror's candidates. Inactive and deceased records are left out of the weak matches. */
export function rankCandidates(p: Probe, cands: Cand[], limit = 8): Match[] {
  const out: Match[] = [];
  for (const c of cands) {
    if (c.inactive) continue;
    const reasons = reasonsFor(p, c);
    if (!reasons.length) continue;
    const weight = Math.max(...reasons.map((x) => WEIGHT[x] || 0)) + reasons.length;
    out.push({
      cid: c.cid, lookup: c.lookup, name: displayName(c), place: [c.city, c.state].filter(Boolean).join(', '), email: c.emails[0] || '', phone: c.phones[0] || '',
      since: c.since, gifts: c.gifts, lastGift: c.lastGift, lastAmount: c.lastAmount, holders: c.holders, deceased: c.deceased, reasons, weight, live: false, fromCopy: true,
    });
  }
  return out.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface LiveHit {
  id: string;
  constituent_id?: string;
  name?: string;
  display_name?: string;
  formatted_address?: string;
  deceased?: boolean;
  date_added?: string;
  rank?: string | number;
}

/**
 * Fold Blackbaud's own duplicate search into the mirror's list. A record both found is marked live. A record only Blackbaud found is added
 * when its rank is high. A record the mirror matched on name alone and Blackbaud did not return is dropped: the mirror keeps merged and
 * deleted records.
 */
export function mergeLive(p: Probe, mirrorMatches: Match[], live: LiveHit[] | null, limit = 8): Match[] {
  if (!live) return mirrorMatches;
  const byId = new Map(live.map((h) => [String(h.id), h]));
  const out: Match[] = [];
  for (const m of mirrorMatches) {
    const h = byId.get(m.cid);
    if (h) out.push({ ...m, live: true });
    else if (m.reasons.some((x) => !NAME_ONLY.has(x))) out.push(m);
  }
  for (const h of live) {
    const id = String(h.id);
    if (out.some((m) => m.cid === id)) continue;
    const rank = Number(h.rank) || 0;
    if (rank < 0.85) continue;
    const addr = String(h.formatted_address || '').toLowerCase();
    const cityHit = !!nm(p.city) && addr.includes(p.city.trim().toLowerCase());
    const reasons = cityHit ? ['Same name and city'] : ['Name match in Blackbaud'];
    out.push({
      cid: id, lookup: String(h.constituent_id || ''), name: String(h.display_name || h.name || '').trim() || '(no name)',
      place: String(h.formatted_address || '').replace(/\r?\n/g, ', ').replace(/\s+/g, ' ').trim(), email: '', phone: '', since: String(h.date_added || '').slice(0, 10), gifts: 0, lastGift: '',
      lastAmount: 0, holders: [], deceased: !!h.deceased, reasons, weight: (WEIGHT[reasons[0]] || 40) + Math.round(rank * 5), live: true, fromCopy: false,
    });
  }
  return out.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, limit);
}

/** The query string for Blackbaud's duplicate search (GET /constituent/v1/constituents/duplicatesearch). The last or organization name is required. */
export function liveQuery(p: Probe): string | null {
  const org = p.kind === 'organization';
  const last = (org ? p.org : p.last).trim();
  if (last.length < 2) return null;
  const q = new URLSearchParams();
  q.set('last_org_name', last);
  q.set('search_individuals', org ? 'false' : 'true');
  if (!org && p.first.trim()) q.set('first_name', p.first.trim());
  if (p.city.trim()) q.set('city', p.city.trim());
  if (p.state.trim()) q.set('state', p.state.trim());
  if (p.zip.trim()) q.set('post_code', p.zip.trim());
  if (p.email.trim()) q.set('email', p.email.trim());
  if (digits(p.phone)) q.set('phone', digits(p.phone));
  q.set('limit', '10');
  return q.toString();
}

/** What a probe needs before any check is worth running. */
export function probeReady(p: Probe): boolean {
  if (p.kind === 'organization') return nm(p.org).length >= 3 || !!digits(p.phone) || !!p.email.trim();
  return nm(p.last).length >= 2 || !!digits(p.phone) || !!p.email.trim();
}

const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function probeOf(b: Record<string, unknown>): Probe {
  const kind: Kind = b.kind === 'household' || b.kind === 'organization' ? b.kind : 'individual';
  return {
    kind,
    first: clean(b.first, 50), last: clean(b.last, 100), spouseFirst: clean(b.spouse_first, 50), spouseLast: clean(b.spouse_last, 100), org: clean(b.org, 100),
    phone: clean(b.phone, 30), email: clean(b.email, 120).toLowerCase(), city: clean(b.city, 60), state: clean(b.state, 30), zip: clean(b.zip, 12),
  };
}
