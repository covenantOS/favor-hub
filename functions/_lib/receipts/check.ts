// The check before printing: reads the gifts that are about to get a receipt and flags a mailing address that will not
// reach the partner, a greeting that will print badly, and two records that look like one partner. Pure and read only: it
// never marks a gift, never changes a record and never makes a print file. Each flag names the field to fix in Blackbaud.
import { isUnitedStates, stateCode, type Gift } from './rules';

export type IssueCode =
  | 'no_name'
  | 'name_looks_wrong'
  | 'no_salutation'
  | 'bad_zip'
  | 'bad_state'
  | 'no_street'
  | 'street_no_number'
  | 'bad_city'
  | 'duplicate';

export interface Issue {
  code: IssueCode;
  /** The group the page counts it under. */
  group: 'address' | 'greeting' | 'duplicate';
  /** One plain sentence about this partner. */
  text: string;
  /** What to change on the Blackbaud record. */
  fix: string;
  /** For a duplicate: the other record's Lookup ID and name. */
  other?: { lookup: string; name: string };
}

const STATE_CODES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP AA AE AP'.split(' ')
);

const PLACEHOLDER = /^(unknown|unnamed|no name|n\/a|na|none|test|friend|friend of favor|anonymous|donor|partner|dear friend|tbd|\?+)$/i;
const TITLES = /\b(mr|mrs|ms|miss|dr|rev|pastor|pst|sr|jr|ii|iii|iv|and|the|family|of)\b\.?/gi;

/** Letters only, lower case, titles and suffixes dropped: "Rev. John A. Smith Jr." becomes "john a smith". */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(TITLES, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUFFIX: Record<string, string> = { street: 'st', avenue: 'ave', road: 'rd', lane: 'ln', drive: 'dr', court: 'ct', boulevard: 'blvd', circle: 'cir', place: 'pl', terrace: 'ter', highway: 'hwy', parkway: 'pkwy', trail: 'trl', north: 'n', south: 's', east: 'e', west: 'w', apartment: 'apt', suite: 'ste' };

/** "1 Elm Road" and "1 elm rd." are one street address. */
export function streetKey(lines: string): string {
  return lines
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] || w)
    .join('');
}

function tokens(name: string): string[] {
  return nameKey(name).split(' ').filter((t) => t.length > 1);
}

/** One of the two names holds every word of the other ("John Smith" and "John and Mary Smith"). */
function oneInsideOther(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  return small.length >= 2 && small.every((t) => big.includes(t));
}

function oneGift(g: Gift, greeting: 'full' | 'first'): Issue[] {
  const out: Issue[] = [];
  const name = (g.addressee || g.name || '').trim();

  // Greeting. The letter prints the addressee after "Dear", and the first name from the salutation when the wording asks for it.
  if (!name) {
    out.push({ code: 'no_name', group: 'greeting', text: 'No addressee on the record, so the letter opens with a blank name.', fix: 'Fill in Primary Addressee (and Primary Salutation) on the record.' });
  } else if (PLACEHOLDER.test(name) || /\d{3,}/.test(name) || /@/.test(name) || (name.length > 3 && name === name.toUpperCase() && /[A-Z]{4,}/.test(name) && !g.organization)) {
    out.push({
      code: 'name_looks_wrong',
      group: 'greeting',
      text: `The addressee reads "${name}", which will print after "Dear".`,
      fix: 'Correct Primary Addressee and Primary Salutation on the record.',
    });
  } else if (greeting === 'first' && !g.organization && !g.salutation) {
    out.push({ code: 'no_salutation', group: 'greeting', text: 'No salutation on the record, so the greeting falls back to the full name.', fix: 'Fill in Primary Salutation on the record.' });
  }

  // Address. A letter with no street or city is already held back; these are addresses that exist and still will not deliver.
  const us = isUnitedStates(g);
  if (us) {
    const zip = g.zip.trim();
    if (!/^\d{5}(-?\d{4})?$/.test(zip)) {
      out.push({ code: 'bad_zip', group: 'address', text: zip ? `ZIP "${zip}" is not a five-digit ZIP.` : 'No ZIP code.', fix: 'Correct the ZIP code on the preferred address.' });
    }
    const st = stateCode(g.state);
    if (!STATE_CODES.has(st)) {
      out.push({ code: 'bad_state', group: 'address', text: g.state ? `State "${g.state}" is not a state or territory.` : 'No state.', fix: 'Correct the state on the preferred address.' });
    }
  }
  const street = g.addressLines.join(' ').trim();
  if (street) {
    if (!/\d/.test(street) && !/\b(p\.?\s?o\.?\s?box|po box|general delivery|rural route|rr\s?\d|hc\s?\d)\b/i.test(street)) {
      out.push({ code: 'street_no_number', group: 'address', text: `The street line "${street.slice(0, 60)}" has no number.`, fix: 'Add the house number or PO box to the address lines.' });
    }
    if (/^(unknown|n\/a|none|no address|\?+|tbd)$/i.test(street)) {
      out.push({ code: 'no_street', group: 'address', text: `The street line reads "${street}".`, fix: 'Replace the address lines with the real street address.' });
    }
  }
  if (g.city && (/\d/.test(g.city) || /^(unknown|n\/a|none|\?+)$/i.test(g.city))) {
    out.push({ code: 'bad_city', group: 'address', text: `City "${g.city}" does not look like a city.`, fix: 'Correct the city on the preferred address.' });
  }
  return out;
}

/**
 * Flags for every gift in `gifts` that will get a receipt, keyed by gift id. A partner with several gifts gets the same flags on each
 * one, so whichever row the person looks at shows them. `gifts` holds only gifts that print: held-back gifts are not checked.
 */
export function checkGifts(gifts: Gift[], greeting: 'full' | 'first' = 'full'): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  const add = (g: Gift, i: Issue) => {
    const list = out.get(g.id) || [];
    if (!list.some((x) => x.code === i.code && x.other?.lookup === i.other?.lookup)) list.push(i);
    out.set(g.id, list);
  };
  for (const g of gifts) for (const i of oneGift(g, greeting)) add(g, i);

  // Two records that look like one partner: the same name, or one name inside the other at the same address or in the same ZIP.
  const people = new Map<string, Gift>();
  for (const g of gifts) {
    const key = g.constituentLookup || g.id;
    if (!people.has(key)) people.set(key, g);
  }
  const list = [...people.entries()];
  const zip5 = (g: Gift) => g.zip.slice(0, 5);
  const addr = (g: Gift) => streetKey(g.addressLines.join(' '));
  const pairs: Array<[Gift, Gift, string]> = [];
  const byName = new Map<string, Array<[string, Gift]>>();
  const byZip = new Map<string, Array<[string, Gift]>>();
  for (const [key, g] of list) {
    const nk = nameKey(g.addressee || g.name);
    if (nk.split(' ').length >= 2) (byName.get(nk) || byName.set(nk, []).get(nk)!).push([key, g]);
    if (zip5(g)) (byZip.get(zip5(g)) || byZip.set(zip5(g), []).get(zip5(g))!).push([key, g]);
  }
  for (const group of byName.values()) {
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) pairs.push([group[a][1], group[b][1], 'the same name']);
    }
  }
  for (const group of byZip.values()) {
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const x = group[a][1];
        const y = group[b][1];
        if (nameKey(x.addressee || x.name) === nameKey(y.addressee || y.name)) continue;
        const sameStreet = addr(x) && addr(x) === addr(y);
        if (sameStreet && oneInsideOther(tokens(x.addressee || x.name), tokens(y.addressee || y.name))) pairs.push([x, y, 'the same address and a name inside the other']);
      }
    }
  }
  const seen = new Set<string>();
  for (const [x, y, why] of pairs) {
    const k = [x.constituentLookup || x.id, y.constituentLookup || y.id].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    for (const [me, other] of [[x, y], [y, x]] as Array<[Gift, Gift]>) {
      const otherName = (other.addressee || other.name).trim();
      for (const g of gifts.filter((q) => (q.constituentLookup || q.id) === (me.constituentLookup || me.id))) {
        add(g, {
          code: 'duplicate',
          group: 'duplicate',
          text: `Possibly the same partner as ${otherName}${other.constituentLookup ? ` (ID ${other.constituentLookup})` : ''}: ${why}.`,
          fix: 'Open both records. If they are one partner, merge them in Blackbaud so the partner gets one letter.',
          other: { lookup: other.constituentLookup, name: otherName },
        });
      }
    }
  }
  return out;
}

export interface CheckSummary {
  /** Partners (not gifts) with at least one flag, by group. */
  address: number;
  greeting: number;
  duplicate: number;
  /** Partners with any flag. */
  partners: number;
}

/** Counts partners, not gifts, so one partner with three gifts is one line on the page. */
export function summarize(gifts: Gift[], flags: Map<string, Issue[]>): CheckSummary {
  const by = { address: new Set<string>(), greeting: new Set<string>(), duplicate: new Set<string>(), any: new Set<string>() };
  for (const g of gifts) {
    const list = flags.get(g.id);
    if (!list || !list.length) continue;
    const who = g.constituentLookup || g.id;
    by.any.add(who);
    for (const i of list) by[i.group].add(who);
  }
  return { address: by.address.size, greeting: by.greeting.size, duplicate: by.duplicate.size, partners: by.any.size };
}
