// The letter engine for the Work Center (round 3, Group C). One file holds the wording and the rules for names, so Marketing can
// review every sentence a letter says in one place. Pure: no database, no Blackbaud, no PDF. HQTY letters ($5,000 and up gifts, one
// letter per gift) and one-to-one thank-you letters from a director both come out of here as a LetterDoc; letters-pdf.ts draws it.

export interface Party {
  /** Blackbaud constituent_type: Individual or Organization. */
  kind: string;
  first?: string | null;
  last?: string | null;
  preferred?: string | null;
  org?: string | null;
  title?: string | null;
  spouseFirst?: string | null;
  spouseLast?: string | null;
  /** The display name Blackbaud holds, used when the pieces above are empty. */
  name?: string | null;
}

export interface Address {
  lines: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface GiftFacts {
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  /** Fund names, comma separated; empty when none is on file. */
  fund: string;
}

export interface LetterDoc {
  /** The letter date as printed: October 14, 2026. */
  dateLine: string;
  /** The mailing block, one line each. */
  addressLines: string[];
  greeting: string;
  paragraphs: string[];
  closing: string;
  /** Printed under the blank signature line. Empty for an HQTY letter, which carries no signer name. */
  signerName: string;
  signerTitle: string;
}

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map((m) => m.slice(0, 3));

export const longDate = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
export const shortDay = (iso: string): string => `${MON3[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
export const monthName = (ym: string): string => MONTHS[Number(ym.slice(5, 7)) - 1] || '';

export const money = (n: number): string => '$' + (Math.round(n) === n ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const isOrg = (p: Party): boolean => p.kind === 'Organization' || (!clean(p.first) && !clean(p.last) && !!clean(p.org || p.name));

/**
 * How a letter names the partner. A couple reads "David and Sandra Blandford" on the envelope and "Dear David and Sandra," inside;
 * a couple with different last names keeps both; an organization, church or foundation reads "Dear friends at The Whitcomb Family
 * Foundation,"; a person with a title and no spouse reads "Dear Dr. Reyes,".
 */
export function nameFor(p: Party): { addressee: string; greeting: string; household: boolean } {
  if (isOrg(p)) {
    const org = clean(p.org || p.name);
    return { addressee: org, greeting: org ? `Dear friends at ${org},` : 'Dear friend,', household: false };
  }
  const first = clean(p.preferred) || clean(p.first);
  const last = clean(p.last);
  const sFirst = clean(p.spouseFirst);
  const sLast = clean(p.spouseLast);
  if (!first && !last) {
    const name = clean(p.name);
    return { addressee: name, greeting: 'Dear friend,', household: false };
  }
  if (sFirst) {
    const same = !sLast || sLast.toLowerCase() === last.toLowerCase();
    return {
      addressee: same ? `${first} and ${sFirst} ${last}`.trim() : `${first} ${last} and ${sFirst} ${sLast}`.trim(),
      greeting: `Dear ${first} and ${sFirst},`,
      household: true,
    };
  }
  const title = clean(p.title);
  return {
    addressee: [title, first, last].filter(Boolean).join(' '),
    greeting: title && last ? `Dear ${title} ${last},` : first ? `Dear ${first},` : `Dear ${last},`,
    household: false,
  };
}

/** The mailing block: the addressee, the street lines and "City, ST ZIP". A foreign country is added on its own line. */
export function addressBlock(p: Party, a: Address | null): string[] {
  const out = [nameFor(p).addressee];
  if (!a) return out;
  for (const l of String(a.lines || '').split(/\r?\n/)) if (clean(l)) out.push(clean(l));
  const place = [clean(a.city), [clean(a.state), clean(a.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (place) out.push(place);
  const c = clean(a.country);
  if (c && !/^(united states|usa|us|u\.s\.a?\.?)$/i.test(c)) out.push(c);
  return out;
}

/** Whether Blackbaud's address can take a letter: a street line, a city and a ZIP or postal code. */
export function usableAddress(a: Address | null): boolean {
  return !!a && !!clean(a.lines) && !!clean(a.city) && !!clean(a.zip || a.state);
}

/** The merge: {amount}, {fund} and {date} are the only fields. */
export function merge(text: string, g: GiftFacts): string {
  return String(text)
    .replace(/\{amount\}/g, money(g.amount))
    .replace(/\{fund\}/g, g.fund ? g.fund : "Favor's work")
    .replace(/\{date\}/g, shortDay(g.date));
}

/** The HQTY letter before a month's text is saved. Two paragraphs, separated by a blank line. */
export const HQTY_DEFAULT = `Thank you for your gift of {amount} on {date}. I am writing to you myself because a gift of this size changes what Favor can do this year.

Your gift to {fund} reaches the people we serve. I am praying for you and your family, and I would welcome the chance to tell you more about what your gift is doing.`;

export const HQTY_CLOSING = 'With gratitude,';

/** A month's letter text split into paragraphs (blank lines separate them). */
export function paragraphsOf(text: string): string[] {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => clean(p))
    .filter(Boolean)
    .slice(0, 8);
}

/** Cleans a month's text before it is saved: at most 2,500 characters, only the known fields. */
export function cleanLetterText(text: unknown): string {
  const t = String(text ?? '').replace(/\r\n/g, '\n').trim().slice(0, 2500);
  return t.replace(/\{(?!amount\}|fund\}|date\})[^}\n]{0,30}\}/g, '');
}

export function hqtyLetter(p: Party, a: Address | null, g: GiftFacts, text: string, today: string): LetterDoc {
  const n = nameFor(p);
  return {
    dateLine: longDate(today),
    addressLines: addressBlock(p, a),
    greeting: n.greeting,
    paragraphs: paragraphsOf(merge(text || HQTY_DEFAULT, g)),
    closing: HQTY_CLOSING,
    // No successor is recorded for the $5,000 signature, so the page prints a blank line and no name.
    signerName: '',
    signerTitle: '',
  };
}

export interface ThankOptions {
  /** What the director said, pasted from the transcript. */
  said?: string;
  designation?: boolean;
  words?: boolean;
  invitation?: boolean;
  fromName: string;
  fromTitle: string;
}

/**
 * A one-to-one thank-you letter from a director. The first paragraph always names the gift. The three switches add a paragraph
 * each: what the gift went to, the director's own words, and an invitation to talk.
 */
export function thankLetter(p: Party, a: Address | null, g: GiftFacts, o: ThankOptions, today: string): LetterDoc {
  const n = nameFor(p);
  const paras: string[] = [];
  const to = g.fund ? ` for ${g.fund}` : '';
  paras.push(`Thank you for your gift of ${money(g.amount)}${to} on ${shortDay(g.date)}.`);
  if (o.designation !== false && g.fund) paras.push(`Because you gave toward ${g.fund}, I wanted you to know the work there continues and your gift goes to it.`);
  const said = clean(o.said).slice(0, 1200);
  if (o.words !== false && said) paras.push(said);
  if (o.invitation) paras.push('I would welcome the chance to talk with you about what your gift is doing. Call me any time.');
  paras.push(n.household ? 'I am praying for you and your family.' : isOrg(p) ? 'I am praying for you and your team.' : 'I am praying for you.');
  return {
    dateLine: longDate(today),
    addressLines: addressBlock(p, a),
    greeting: n.greeting,
    paragraphs: paras,
    closing: 'With gratitude,',
    signerName: clean(o.fromName),
    signerTitle: clean(o.fromTitle),
  };
}

/** The title a letter prints for a Blackbaud fundraiser type. */
export function titleFor(type: string): string {
  const t = clean(type);
  if (/^Regional Development Director/i.test(t)) return 'Regional Development Director';
  return t;
}

/** The plain text of a letter, for Copy for email. */
export function letterText(d: LetterDoc): string {
  return [d.greeting, '', ...d.paragraphs.flatMap((p) => [p, '']), d.closing, '', d.signerName, d.signerTitle].filter((x, i, arr) => !(x === '' && arr[i - 1] === '' )).join('\n').trim();
}
