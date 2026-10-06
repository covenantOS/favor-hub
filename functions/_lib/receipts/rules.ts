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
  key: '' | 'small' | 'no_mail' | 'deceased' | 'no_address' | 'abroad' | 'pass_through' | 'organization' | 'inactive' | 'gift_type';
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

export function isUnitedStates(g: Gift): boolean {
  const c = g.country.toLowerCase();
  if (c === 'united states' || c === 'usa' || c === 'us' || c === 'united states of america') return true;
  // A record with no country but a state and a five-digit ZIP is a US address.
  return c === '' && /^[A-Z]{2}$/.test(g.state) && /^\d{5}/.test(g.zip);
}

export function verdict(g: Gift): Verdict {
  if (!LETTER_TYPES.includes(g.type)) {
    return { letter: false, key: 'gift_type', reason: `Gift type is ${g.type || 'blank'}`, canAdd: true };
  }
  if (g.amount < MIN_AMOUNT) return { letter: false, key: 'small', reason: 'Under $10', canAdd: false };
  if (g.solicitCodes.some((c) => /^do not mail$/i.test(c)) || !g.sendMail) {
    return { letter: false, key: 'no_mail', reason: 'Marked Do Not Mail', canAdd: false };
  }
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
  }
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

export interface Letter {
  giftId: string;
  giftLookup: string;
  constituentLookup: string;
  sortName: string;
  addressee: string;
  greetingFull: string;
  greetingFirst: string;
  addressLines: string[];
  cityLine: string;
  giftDate: string;
  amount: number;
  fund: string;
  giftType: string;
  segment: Segment;
}

/** What the letter prints. The addressee is the one Raiser's Edge holds, so a couple gets both names. */
export function letterFor(g: Gift): Letter {
  const addressee = g.addressee || g.name;
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
    giftDate: g.date,
    amount: g.amount,
    fund: g.funds.join(', '),
    giftType: g.type,
    segment: segmentOf(g),
  };
}

/** Alphabetical by record, so two receipts for one household come off the printer together. */
export function byHousehold(a: Letter, b: Letter): number {
  return a.sortName.localeCompare(b.sortName, 'en', { sensitivity: 'base' }) || a.giftDate.localeCompare(b.giftDate) || a.giftId.localeCompare(b.giftId);
}
