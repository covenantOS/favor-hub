import type { Gift, ObligationKind } from './types.ts';
import type { Params } from './params.ts';
import { DEFAULTS } from './params.ts';
import { daysBetween } from './dates.ts';

// One thank-you obligation per gift, or per group of gifts (spec 5.4 mechanics 1, 2 and 6).
// The unique index in spec 5.2 is (kind, partner_id, gift_id): a group is stored under its anchor gift,
// the earliest gift in the group, and the other gifts are linked to it.

export interface GiftGroup {
  partnerId: string; // the credited record: the soft-credit person when there is one, else the giver (followups.js:110)
  gifts: Gift[]; // sorted by gift date, then id
  anchor: Gift;
  total: number;
  firstGiftDate: string;
  lastGiftDate: string;
  firstEnteredDate: string;
}

export interface Obligation {
  key: string;
  kind: ObligationKind;
  partnerId: string;
  giverIds: string[]; // every record a task about this gift might sit on
  giftId: string; // anchor gift
  giftIds: string[];
  amount: number;
  gifts: Gift[];
  firstGiftDate: string;
  firstEnteredDate: string;
}

/** The person who is thanked: the first soft-credit person when there is one, else the giver. */
export function creditedPartner(g: Gift): string {
  return g.softCreditIds[0] ?? g.giverId;
}

const byDateThenId = (a: Gift, b: Gift) => (a.giftDate < b.giftDate ? -1 : a.giftDate > b.giftDate ? 1 : Number(a.id) - Number(b.id));

/**
 * Collapse one partner's gifts that fall inside a window. The window is anchored on the first gift of a group
 * (a gift joins when it is no more than windowDays after that first gift), so a long run of monthly gifts never
 * chains into one group. windowDays of 0 or less turns grouping off: every gift is its own group (spec 5.4.6, Q14).
 */
export function groupGifts(gifts: Gift[], windowDays: number): GiftGroup[] {
  const byPartner = new Map<string, Gift[]>();
  for (const g of gifts) {
    const p = creditedPartner(g);
    if (!byPartner.has(p)) byPartner.set(p, []);
    byPartner.get(p)!.push(g);
  }
  const groups: GiftGroup[] = [];
  for (const [partnerId, list] of byPartner) {
    list.sort(byDateThenId);
    let current: Gift[] = [];
    const flush = () => {
      if (!current.length) return;
      const sorted = current.slice().sort(byDateThenId);
      groups.push({
        partnerId,
        gifts: sorted,
        anchor: sorted[0],
        total: Math.round(sorted.reduce((s, g) => s + g.amount, 0) * 100) / 100,
        firstGiftDate: sorted[0].giftDate,
        lastGiftDate: sorted[sorted.length - 1].giftDate,
        firstEnteredDate: sorted.map((g) => g.enteredDate).sort()[0],
      });
      current = [];
    };
    for (const g of list) {
      if (current.length && windowDays > 0 && daysBetween(current[0].giftDate, g.giftDate) <= windowDays) {
        current.push(g);
      } else {
        flush();
        current = [g];
      }
    }
    flush();
  }
  return groups.sort((a, b) => (a.firstGiftDate < b.firstGiftDate ? -1 : a.firstGiftDate > b.firstGiftDate ? 1 : Number(a.anchor.id) - Number(b.anchor.id)));
}

/** The stable key. The same gift or group always gives the same key, whichever creator asks (spec 5.4 mechanic 1). */
export function obligationKey(kind: ObligationKind, group: GiftGroup): string {
  return `${kind}|${group.partnerId}|${group.anchor.id}`;
}

export function owesThanks(g: Gift, p: Params = DEFAULTS): boolean {
  return (
    g.status === 'Active' &&
    (g.type === 'Donation' || g.type === 'RecurringGiftPayment') &&
    g.amount > 0 &&
    g.amount >= p.PERSONAL_THANKS_MIN_AMOUNT
  );
}

function toObligation(kind: ObligationKind, group: GiftGroup): Obligation {
  const givers = [...new Set(group.gifts.map((g) => g.giverId).concat(group.partnerId))];
  return {
    key: obligationKey(kind, group),
    kind,
    partnerId: group.partnerId,
    giverIds: givers,
    giftId: group.anchor.id,
    giftIds: group.gifts.map((g) => g.id),
    amount: group.total,
    gifts: group.gifts,
    firstGiftDate: group.firstGiftDate,
    firstEnteredDate: group.firstEnteredDate,
  };
}

/**
 * All obligations a set of gifts creates.
 * - A one-time Donation owes a personal_thanks, grouped by GROUP_WINDOW_DAYS.
 * - A RecurringGiftPayment owes a cadence touch, grouped by CADENCE_WINDOW_DAYS (spec 5.4.6).
 * - Any owed gift at or above HQ_LETTER_MIN_AMOUNT also owes an hq_letter, one per gift (spec 5.4.2, Q3).
 * The RecurringGift commitment record itself is not a payment and owes nothing here.
 */
export function buildObligations(gifts: Gift[], p: Params = DEFAULTS): Obligation[] {
  const owed = gifts.filter((g) => owesThanks(g, p));
  const out: Obligation[] = [];
  for (const group of groupGifts(owed.filter((g) => g.type === 'Donation'), p.GROUP_WINDOW_DAYS)) out.push(toObligation('personal_thanks', group));
  for (const group of groupGifts(owed.filter((g) => g.type === 'RecurringGiftPayment'), p.CADENCE_WINDOW_DAYS)) out.push(toObligation('cadence', group));
  for (const g of owed.filter((x) => x.amount >= p.HQ_LETTER_MIN_AMOUNT)) {
    out.push(toObligation('hq_letter', groupGifts([g], 0)[0]));
  }
  return out;
}
