// Who gets a thank-you receipt.
//
// These rules come from the Database View mail task this page replaces
// ("TY Letters Updated", 2024-11-15) and from the hand clean-up staff did on
// its export. Read against 3,610 gifts dated March to August 2026:
//   - no gift from one cent to $9.99 was ever marked thanked (0 of 184); all 121 gifts of exactly $10 were
//   - a record carrying the solicit code Do Not Mail was left out (5 of 149 marked)
//   - foreign addresses, records with no address, foundations and businesses
//     were exported, marked thanked, and then deleted from the list by hand
// One letter goes out per gift, to the giver.

export const MIN_AMOUNT = 10;
export const MAJOR_AMOUNT = 200;

// The gifts arrive as the CSV of an unsaved Raiser's Edge query the sync
// worker runs (re-nxt-cloud-sync, src/receipts/receipts.js), one row per
// solicit code, fund and soft credit. The columns are read by name below.

export type Segment = 'regular' | 'major' | 'recurring';

export interface Gift {
  /** Raiser's Edge system id of the gift. */
  id: string;
  /** The gift ID staff see on the record. */
  lookup: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  type: string;
  constituency: string;
  constituentLookup: string;
  name: string;
  sortName: string;
  organization: boolean;
  deceased: boolean;
  inactive: boolean;
  addressee: string;
  salutation: string;
  solicitCodes: string[];
  addressLines: string[];
  city: string;
  state: string;
  zip: string;
  country: string;
  sendMail: boolean;
  funds: string[];
  softCredits: string[];
}

export interface Verdict {
  letter: boolean;
  /** Short label for the list. Empty when the gift gets a letter. */
  reason: string;
  key: '' | 'small' | 'no_mail' | 'preference' | 'deceased' | 'no_address' | 'abroad' | 'pass_through' | 'organization' | 'inactive' | 'gift_type';
  /** Staff may send it anyway. */
  canAdd: boolean;
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'puerto rico': 'PR', guam: 'GU', 'virgin islands': 'VI', 'american samoa': 'AS', 'northern mariana islands': 'MP',
  'armed forces americas': 'AA', 'armed forces europe': 'AE', 'armed forces pacific': 'AP',
};

export function stateCode(value: string): string {
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return STATES[v.toLowerCase()] ?? v;
}

function isoDate(value: string): string {
  // "7/8/2026 12:00:00 AM" or "2026-07-08T00:00:00"
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
}

function yes(value: string): boolean {
  return /^(yes|true|1)$/i.test(value.trim());
}

function push(list: string[], value: string): void {
  const v = tidy(value);
  if (v && !list.includes(v)) list.push(v);
}

/** Records carry stray double spaces ("Shenoda  Abd Elmaseh"). */
function tidy(value: string): string {
  return value.replace(/[ 	]+/g, ' ').trim();
}

/** Query rows to gifts. A gift with two solicit codes or two funds comes back as several rows. */
export function giftsFromRows(rows: Record<string, string>[]): Gift[] {
  const byId = new Map<string, Gift>();
  for (const r of rows) {
    const id = (r['QRECID'] || '').trim();
    if (!id) continue;
    let g = byId.get(id);
    if (!g) {
      g = {
        id,
        lookup: (r['Gift ID'] || '').trim(),
        date: isoDate(r['Gift Date'] || ''),
        amount: Number(r['Gift Amount']) || 0,
        type: tidy(r['Gift Type'] || ''),
        constituency: tidy(r['Gift Constituency'] || ''),
        constituentLookup: (r['Constituent ID'] || '').trim(),
        name: tidy(r['Name'] || ''),
        sortName: tidy(r['Sort Name'] || ''),
        organization: /^org/i.test(r['Key Indicator'] || ''),
        deceased: yes(r['Deceased'] || ''),
        inactive: yes(r['Inactive?'] || ''),
        addressee: tidy(r['Primary Addressee'] || ''),
        salutation: tidy(r['Primary Salutation'] || ''),
        solicitCodes: [],
        addressLines: (r['Preferred Address Lines'] || '')
          .split(/\r?\n/)
          .map(tidy)
          .filter(Boolean),
        city: tidy(r['Preferred City'] || ''),
        state: stateCode(r['Preferred State'] || ''),
        zip: tidy(r['Preferred ZIP'] || ''),
        country: tidy(r['Preferred Country'] || ''),
        sendMail: !/^no$/i.test((r['Preferred Send Mail To This Address'] || '').trim()),
        funds: [],
        softCredits: [],
      };
      byId.set(id, g);
    }
    push(g.solicitCodes, r['Solicit Code Description'] || '');
    push(g.funds, r['Fund Description'] || '');
    push(g.softCredits, r['Soft Credit Recipient Sort Name'] || '');
  }
  return [...byId.values()];
}

const LETTER_TYPES = ['One-Time Gift', 'Recurring Gift Payment'];
const ORGANIZATIONS_THAT_GET_ONE = ['Church', 'Ministry'];
/** Gift constituencies that mean the money came through an organization, even on a person's record. */
const PASSED_THROUGH: Record<string, string> = {
  Foundation: 'a foundation',
  Business: 'a business',
  'DAF Provider': 'a DAF',
  'Donor Advised Fund': 'a DAF',
};

// Raiser's Edge's own solicit codes (GET /constituent/v1/communicationpreferences, 26 of them on 2026-10-06).
/** No thank-you letter, ever. */
const NO_LETTER_CODES = ['do not mail', 'do not contact', 'do not mail thank you'];
/** The pre-printed reply slip asks for a gift, so these wait for a person to decide. */
const ASK_FIRST_CODES = ['do not mail solicitation', 'do not solicit', 'all email', 'event invitations only'];

/** U.S. mail: the states, plus the territories the Postal Service delivers to at domestic rates. */
const DOMESTIC = ['united states', 'united states of america', 'usa', 'us', 'puerto rico', 'guam', 'u.s. virgin islands', 'virgin islands',
  'united states virgin islands', 'american samoa', 'northern mariana islands'];

export function isUnitedStates(g: Gift): boolean {
  const c = g.country.toLowerCase();
  if (DOMESTIC.includes(c)) return true;
  // A record with no country but a state and a five-digit ZIP is a US address.
  return c === '' && /^[A-Z]{2}$/.test(g.state) && /^\d{5}/.test(g.zip);
}

export function verdict(g: Gift): Verdict {
  if (!LETTER_TYPES.includes(g.type)) {
    return { letter: false, key: 'gift_type', reason: `Gift type is ${g.type || 'blank'}`, canAdd: true };
  }
  if (g.amount < MIN_AMOUNT) return { letter: false, key: 'small', reason: 'Under $10', canAdd: false };
  const noLetter = g.solicitCodes.find((c) => NO_LETTER_CODES.includes(c.toLowerCase()));
  if (noLetter) return { letter: false, key: 'no_mail', reason: `Marked ${noLetter}`, canAdd: false };
  if (!g.sendMail) return { letter: false, key: 'no_mail', reason: 'Address marked no mail', canAdd: false };
  if (g.deceased) return { letter: false, key: 'deceased', reason: 'Marked deceased', canAdd: false };
  if (g.addressLines.length === 0 || !g.city || !g.zip) {
    return { letter: false, key: 'no_address', reason: 'No mailing address on the record', canAdd: false };
  }
  if (!isUnitedStates(g)) {
    return { letter: false, key: 'abroad', reason: `Address is in ${g.country || 'another country'}`, canAdd: false };
  }
  if (g.organization) {
    if (g.softCredits.length > 0) {
      return { letter: false, key: 'pass_through', reason: `Passed along for ${g.softCredits[0]}`, canAdd: true };
    }
    if (!ORGANIZATIONS_THAT_GET_ONE.includes(g.constituency)) {
      return { letter: false, key: 'organization', reason: `Organization (${g.constituency || 'no code'})`, canAdd: true };
    }
  } else if (PASSED_THROUGH[g.constituency]) {
    return { letter: false, key: 'organization', reason: `Gift came through ${PASSED_THROUGH[g.constituency]}`, canAdd: true };
  }
  const ask = g.solicitCodes.find((c) => ASK_FIRST_CODES.includes(c.toLowerCase()));
  if (ask) return { letter: false, key: 'preference', reason: `Marked ${ask}`, canAdd: true };
  if (g.inactive) return { letter: false, key: 'inactive', reason: 'Record marked inactive', canAdd: true };
  return { letter: true, key: '', reason: '', canAdd: false };
}

export function segmentOf(g: Pick<Gift, 'type' | 'amount'>): Segment {
  if (g.type === 'Recurring Gift Payment') return 'recurring';
  return g.amount >= MAJOR_AMOUNT ? 'major' : 'regular';
}

/** Y + two-digit year + month (1 to 9, then A, B, C) + "-TY". October 2026 is Y26A-TY. */
export function appealCode(isoDay: string): string {
  const [y, m] = isoDay.split('-').map(Number);
  return `Y${String(y).slice(2)}${'123456789ABC'[m - 1]}-TY`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 2026-10-06 to "October 6, 2026". */
export function longDate(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** 2026-10-06 to "10/6/2026". */
export function shortDate(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

export function money(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface LetterGift {
  id: string;
  lookup: string;
  date: string;
  amount: number;
  type: string;
  fund: string;
}

export interface Letter {
  /** The first gift's system id; every gift the letter covers is in `gifts`. */
  giftId: string;
  giftLookup: string;
  constituentLookup: string;
  sortName: string;
  addressee: string;
  greetingFull: string;
  greetingFirst: string;
  addressLines: string[];
  cityLine: string;
  /** Street and ZIP, so letters for one address can be kept together in the print file. */
  addressKey?: string;
  /** The latest gift's date. */
  giftDate: string;
  /** All the gifts in the letter, added up. */
  amount: number;
  fund: string;
  giftType: string;
  segment: Segment;
  gifts: LetterGift[];
}

/** What the letter prints. The addressee is the one Raiser's Edge holds, so a couple gets both names. */
export function letterFor(g: Gift): Letter {
  const addressee = g.addressee || g.name;
  const fund = g.funds.join(', ');
  return {
    giftId: g.id,
    giftLookup: g.lookup,
    constituentLookup: g.constituentLookup,
    sortName: g.sortName || g.name,
    addressee,
    greetingFull: addressee,
    greetingFirst: g.organization ? addressee : g.salutation || addressee,
    addressLines: g.addressLines,
    cityLine: `${g.city}, ${g.state} ${g.zip}`.trim(),
    addressKey: addressKeyOf(g.addressLines, g.zip),
    giftDate: g.date,
    amount: g.amount,
    fund,
    giftType: g.type,
    segment: segmentOf(g),
    gifts: [{ id: g.id, lookup: g.lookup, date: g.date, amount: g.amount, type: g.type, fund }],
  };
}

/** The reply slip for several gifts: monthly when every gift is a monthly payment, else by the largest one-time gift. */
export function segmentOfGifts(gifts: Pick<LetterGift, 'type' | 'amount'>[]): Segment {
  const once = gifts.filter((x) => x.type !== 'Recurring Gift Payment');
  if (once.length === 0) return 'recurring';
  return Math.max(...once.map((x) => x.amount)) >= MAJOR_AMOUNT ? 'major' : 'regular';
}

/**
 * One letter per partner. A partner with several gifts in one print file gets a single letter that
 * lists each gift's date and the total, so nobody gets two envelopes the same day.
 */
export function combineLetters(letters: Letter[]): Letter[] {
  const groups = new Map<string, Letter[]>();
  for (const l of letters) {
    const key = l.constituentLookup || `${l.addressee}|${l.addressLines.join(' ')}|${l.cityLine}`;
    const list = groups.get(key);
    if (list) list.push(l);
    else groups.set(key, [l]);
  }
  const out: Letter[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const gifts = list.flatMap((l) => l.gifts).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
    const funds = [...new Set(gifts.flatMap((x) => x.fund.split(', ')).filter(Boolean))];
    out.push({
      ...list[0],
      giftId: gifts[0].id,
      giftLookup: gifts[0].lookup,
      giftDate: gifts[gifts.length - 1].date,
      amount: Math.round(gifts.reduce((t, x) => t + x.amount, 0) * 100) / 100,
      fund: funds.join(', '),
      giftType: gifts.every((x) => x.type === gifts[0].type) ? gifts[0].type : 'Several',
      segment: segmentOfGifts(gifts),
      gifts,
    });
  }
  return out;
}

/** Alphabetical by record, so two receipts for one household come off the printer together. */
/** Street and five-digit ZIP with the punctuation taken out: "123 Main St." and "123 main st" are one address. */
export function addressKeyOf(lines: string[], zip: string): string {
  return lines.length ? `${lines.join(' ').toLowerCase().replace(/[^a-z0-9]/g, '')}|${zip.slice(0, 5)}` : '';
}

/**
 * The order the print file uses: alphabetical, with every letter for one street address kept
 * together under the first name among them. Two records in one household (a husband and wife
 * Blackbaud holds apart, or one person entered twice) come off the printer back to back and can
 * share an envelope.
 */
export function inPrintOrder(letters: Letter[]): Letter[] {
  const sorted = [...letters].sort(byHousehold);
  const key = (l: Letter, i: number) => l.addressKey || `#${i}`;
  const first = new Map<string, number>();
  sorted.forEach((l, i) => {
    if (!first.has(key(l, i))) first.set(key(l, i), i);
  });
  return sorted
    .map((l, i) => ({ l, i, at: first.get(key(l, i)) as number }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((x) => x.l);
}

export function byHousehold(a: Letter, b: Letter): number {
  return a.sortName.localeCompare(b.sortName, 'en', { sensitivity: 'base' }) || a.giftDate.localeCompare(b.giftDate) || a.giftId.localeCompare(b.giftId);
}
