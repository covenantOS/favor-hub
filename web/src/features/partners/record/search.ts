// The partner page's address search part, in a module with no components, so the route file can check ?as=, ?gift= and ?opp=
// without pulling the whole partner page into the first-screen chunk (a route's validateSearch is never split off).
export interface PartnerSearch {
  as?: string;
  gift?: string;
  opp?: string;
}

/** Checks the address's search part for the partner page. */
export function validatePartnerSearch(raw: Record<string, unknown>): PartnerSearch {
  const out: PartnerSearch = {};
  if (typeof raw.as === 'string' && raw.as.trim()) out.as = raw.as.slice(0, 120);
  const num = (v: unknown) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '');
  if (/^\d{1,12}$/.test(num(raw.gift))) out.gift = num(raw.gift);
  if (/^\d{1,12}$/.test(num(raw.opp))) out.opp = num(raw.opp);
  return out;
}
