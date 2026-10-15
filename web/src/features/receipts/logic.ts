// The pure rules of the Receipts page: how gifts group into receipts, what each count means, which flags show. No React, no window.
// (Port of the helpers in public/js/receipts.js.)
import type { Batch, Issue, Item, Segment, Waiting } from './api';

export const KINDS: Record<string, string> = { regular: 'Regular', major: '$200 and up', recurring: 'Monthly' };
export const PAGE = 50; // receipts on a page of the list
export const HELD_SHOW = 10; // rows a long held-back group shows before "Show all"

export const HELD: Record<string, [string, string]> = {
  no_address: ['No mailing address', 'Add the address in Blackbaud and the gift comes back to the receipts.'],
  preference: ['Asked for less mail', 'The record is marked Do Not Mail Solicitation, Do Not Solicit, All Email or Event Invitations Only. The reply slip asks for a gift, so add a receipt only if you know this partner wants a paper receipt.'],
  pass_through: ['Passed along for a partner', 'A fund or brokerage sent it for someone else. Add a receipt only if you mean to thank the organization.'],
  organization: ['Foundation, business or fund', 'Churches and ministries get receipts. Other organizations do not, and neither does a person whose gift came through a foundation, business or DAF.'],
  inactive: ['Record marked inactive', ''],
  deceased: ['Marked deceased', ''],
  abroad: ['Outside the U.S.', 'Receipts go to U.S. addresses only.'],
  no_mail: ['No mail', 'The record is marked Do Not Mail, Do Not Contact or Do Not Mail Thank You, or its address is marked not to send mail.'],
  small: ['Under $10', 'Gifts under $10 never got a receipt.'],
  gift_type: ['Other gift types', ''],
  first_gift: ['First-gift letter', 'Their first gift came from an acquisition mailing, so it gets a first-gift letter and no receipt. It is on Gifts, First-gift letters.'],
  first_gift_file: ['In a first-gift letters print file', 'It is marked acknowledged when that print file is marked, and then it leaves this list.'],
};

export const FLAG_WORD: Record<string, string> = { address: 'Address.', greeting: 'Greeting.', duplicate: 'Duplicate.' };

/** One receipt: the gifts of one partner that print together. */
export interface Group {
  gifts: Item[];
  first: Item;
  segment: Segment;
  batch: { id: string; letterDate: string } | null;
}

export interface Counts {
  regular: number;
  major: number;
  recurring: number;
  letters: number;
  gifts: number;
}

export const openBatchOf = (batches: Batch[]): Batch | undefined => batches.find((b) => b.kind === 'new' && (b.status === 'printing' || b.status === 'marking'));

/** The print file makes one receipt per partner, listing each of the partner's gifts. */
export const partnerKey = (l: Item): string => l.constituentLookup || `${l.addressee}|${l.addressKey}`;

export function segmentOfGifts(gifts: Item[]): Segment {
  const once = gifts.filter((x) => x.type !== 'Recurring Gift Payment');
  if (!once.length) return 'recurring';
  return Math.max(...once.map((x) => x.amount)) >= 200 ? 'major' : 'regular';
}

/** Gifts grouped into receipts. A gift already in a print file stays with that file's receipt. */
export function groupLetters(list: Item[]): Group[] {
  const by = new Map<string, Item[]>();
  for (const l of list) {
    const k = `${partnerKey(l)}|${l.batch ? l.batch.id : ''}`;
    const got = by.get(k);
    if (got) got.push(l);
    else by.set(k, [l]);
  }
  return [...by.values()].map((gifts) => ({ gifts, first: gifts[0], segment: segmentOfGifts(gifts), batch: gifts[0].batch || null }));
}

export function countsOf(list: Item[]): Counts {
  const c: Counts = { regular: 0, major: 0, recurring: 0, letters: 0, gifts: list.length };
  for (const g of groupLetters(list)) {
    c[g.segment] += 1;
    c.letters += 1;
  }
  return c;
}

/** The gifts that will print: every waiting gift not in a file and not unticked, plus the held-back gifts added back. */
export function printableOf(v: Waiting | null, left: Set<string>, added: Set<string>): Item[] {
  if (!v) return [];
  const picked = v.letters.filter((l) => !l.batch && !left.has(l.id));
  const extra = v.held.filter((h) => !h.batch && added.has(h.id));
  return picked.concat(extra);
}

/** Street addresses with receipts for two or more different records. Often one household with two records. */
export function sharedAddresses(v: Waiting, added: Set<string>): Map<string, Map<string, string>> {
  const going = v.letters.filter((l) => !l.batch).concat(v.held.filter((h) => !h.batch && added.has(h.id)));
  const at = new Map<string, Map<string, string>>();
  for (const l of going) {
    if (!l.addressKey) continue;
    let m = at.get(l.addressKey);
    if (!m) at.set(l.addressKey, (m = new Map()));
    m.set(partnerKey(l), l.addressee);
  }
  return new Map([...at].filter(([, records]) => records.size > 1));
}

/** The flags on a receipt: every gift of the partner carries the same ones, so the first gift's list is the partner's. */
export function issuesOf(g: Group): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const x of g.gifts)
    for (const i of x.issues || []) {
      const k = i.code + '|' + ((i.other && i.other.lookup) || '');
      if (!seen.has(k)) {
        seen.add(k);
        out.push(i);
      }
    }
  return out;
}

/** The receipts the filter pills and the search box leave, all pages. */
export function filteredLetters(v: Waiting, filter: string, find: string): Group[] {
  const q = find.toLowerCase();
  return groupLetters(v.letters).filter(
    (g) =>
      (filter === 'all' || (filter === 'check' ? issuesOf(g).length > 0 && !g.batch : g.segment === filter)) &&
      (!q || g.gifts.some((l) => `${l.addressee} ${l.place} ${l.lookup} ${l.constituentLookup}`.toLowerCase().includes(q)))
  );
}

/** How many receipts still carry a flag among the ones going to print. */
export function flaggedGoing(v: Waiting, going: Item[]): number {
  const ids = new Set(going.map((x) => x.constituentLookup || x.id));
  return groupLetters(v.letters).filter((g) => !g.batch && issuesOf(g).length && ids.has(g.first.constituentLookup || g.first.id)).length;
}
