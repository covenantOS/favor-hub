// Fundraiser credit and assignments: what a gift's credit should be by Favor's rules, and the proposals that fix a difference.
// Pure functions here; the mirror reads, the stored proposals and the apply step are in credit-service.ts.
//
// Favor's rules (vault Rulebook, memory gift-credit-comes-from-assign-queries, 2026-10-06 ruling):
//  1. Credit comes from the partner's assignment, never from the P or W in the gift code. A soft-credited gift follows the soft-credited partner.
//  2. Eligible appeal categories are White Mail, Portfolio, Personal Contact and the Director categories. Marketing categories (Digital Newsletter,
//     Direct Mail Appeal, Direct Mail Newsletter, Thank You Letter, Media) carry no fundraiser credit by design.
//  3. Credit stays with the holder at the gift date. A director who left keeps credit for gifts dated in his time, so a credit on a former holder is
//     never proposed for removal when his assignment covered the gift date.
//  4. Past numbers do not change except as a closed-month correction (Will, 2026-10-09). A proposal on a gift dated before this month says so.
//  5. A gift with no credit and a holder on its date, in an eligible category, gets that holder's credit.

export const MARKETING_CATEGORIES = ['Digital Newsletter', 'Direct Mail Appeal', 'Direct Mail Newsletter', 'Thank You Letter', 'Media'];
export const ELIGIBLE_CATEGORIES = ['White Mail', 'Portfolio', 'Personal Contact'];
/** Assignment types that carry gift credit. */
export const CREDIT_TYPES = ['Regional Development Director (RDD)', 'Partner Care', 'Church Engagement Director'];

export const isEligible = (cat: string | null | undefined): boolean => !!cat && (ELIGIBLE_CATEGORIES.includes(cat) || cat.startsWith('Director'));
export const isMarketing = (cat: string | null | undefined): boolean => !!cat && MARKETING_CATEGORIES.includes(cat);

export interface Assignment {
  id: string;
  cid: string;
  fid: string;
  type: string;
  from: string;
  /** Empty while the assignment is open. */
  to: string;
}
export interface GiftFacts {
  id: string;
  date: string;
  amount: number;
  /** The partners the gift counts for: the soft-credited records, or the giver. */
  partners: string[];
  category: string;
  code: string;
  credits: Array<{ fid: string; amount: number }>;
}

export type Op = 'add' | 'remove';
export interface CreditProposal {
  kind: 'credit';
  giftId: string;
  fundraiserId: string;
  op: Op;
  amount: number;
  rule: string;
  reason: string;
  closedMonth: boolean;
  /** The credits on the gift before the change, kept so an undo can restore them. */
  before: Array<{ fid: string; amount: number }>;
}

const day = (s: unknown) => String(s ?? '').slice(0, 10);

/** Assignments of the given partners that covered the date. */
export function holdersOn(assignments: Assignment[], partners: string[], date: string): Assignment[] {
  return assignments.filter((a) => partners.includes(a.cid) && CREDIT_TYPES.includes(a.type) && a.from <= date && (!a.to || a.to >= date));
}

export const monthOf = (d: string) => d.slice(0, 7);

/** What, if anything, should change on one gift. Returns at most one proposal per fundraiser. */
export function proposeForGift(g: GiftFacts, assignments: Assignment[], today: string): CreditProposal[] {
  const out: CreditProposal[] = [];
  const closed = monthOf(g.date) < monthOf(today);
  const base = { kind: 'credit' as const, giftId: g.id, closedMonth: closed, before: g.credits };
  if (g.amount <= 0) return out;
  if (isMarketing(g.category)) {
    for (const c of g.credits) {
      out.push({ ...base, fundraiserId: c.fid, op: 'remove', amount: c.amount, rule: 'marketing', reason: `${g.category} appeals carry no fundraiser credit` });
    }
    return out;
  }
  if (!isEligible(g.category)) return out;
  const holders = holdersOn(assignments, g.partners, g.date);
  const have = new Set(g.credits.map((c) => c.fid));
  const seen = new Set<string>();
  for (const h of holders) {
    if (have.has(h.fid) || seen.has(h.fid)) continue;
    seen.add(h.fid);
    out.push({ ...base, fundraiserId: h.fid, op: 'add', amount: g.amount, rule: 'holder', reason: `${h.type.replace(' (RDD)', '')} on ${g.date}` });
  }
  return out;
}

/** Credits on a fundraiser who did not hold the partner on the gift date and does not now. Shown for a person to look at, never changed by the page. */
export function oddCredits(g: GiftFacts, assignments: Assignment[]): Array<{ fid: string; reason: string }> {
  if (isMarketing(g.category)) return [];
  const on = new Set(holdersOn(assignments, g.partners, g.date).map((a) => a.fid));
  const now = new Set(assignments.filter((a) => g.partners.includes(a.cid) && !a.to).map((a) => a.fid));
  return g.credits.filter((c) => !on.has(c.fid) && !now.has(c.fid)).map((c) => ({ fid: c.fid, reason: 'Not holding this partner on the gift date or now' }));
}

// ---- who may do what ----
export interface Actor {
  email: string;
  admin: boolean;
  /** act_staff.team */
  team: string;
  /** Emails in act_settings lists:credit_approvers. */
  named: string[];
}

/** Approvers: hub admins, the Operations team (Who Does What lists Michael Hinton and Crystal Moux there), and anyone an admin names. */
export const mayApprove = (a: Actor): boolean => a.admin || a.team === 'admin' || a.named.includes(a.email.toLowerCase());
/** Anyone who can open Lists and sees the partner may suggest a change. */
export const mayPropose = (_a: Actor): boolean => true;

export type State = 'proposed' | 'approved' | 'rejected' | 'queued' | 'applied' | 'failed' | 'cancelled';

/** The state an approval leads to. With apply off the change stays approved and nothing leaves the hub. */
export function afterApproval(applyOn: boolean, kind: 'credit' | 'assignment'): State {
  return applyOn ? (kind === 'credit' ? 'queued' : 'applied') : 'approved';
}

/** The call that carries out an assignment change through the upkeep route (existing path). */
export function assignmentCall(c: { op: 'end' | 'add'; assignmentId?: string; recordId?: string; fundraiserId?: string; type?: string; date: string }): { method: string; path: string; body: unknown } {
  if (c.op === 'end') return { method: 'PATCH', path: `/fundraising/v1/fundraisers/assignments/${c.assignmentId}`, body: { end: `${c.date}T00:00:00` } };
  return { method: 'POST', path: '/fundraising/v1/fundraisers/assignments', body: { constituent_id: c.recordId, fundraiser_id: c.fundraiserId, type: c.type, start: `${c.date}T00:00:00` } };
}

export { day };
