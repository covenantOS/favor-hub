import type { Assignment, Fundraiser, ObligationKind } from './types.ts';
import type { Params } from './params.ts';
import { DEFAULTS } from './params.ts';

// ownerFor: who owes the work (spec 5.4 mechanic 2).
// The fundraiser credited on the gift after the 6 AM gift phase, then the current holder of the partner,
// then Partner Care. An hq_letter goes to the Support Team (signed by a director, spec 5.4.2).
// A departed fundraiser is never an owner (rule S2).

export type OwnerSource = 'gift_credit' | 'assignment' | 'partner_care_default' | 'support_queue';

export interface OwnerContext {
  today: string;
  fundraisers: Map<string, Fundraiser>;
  assignments: Assignment[]; // the partner's assignments, any dates
  giftFundraiserIds: string[]; // credited on the gift, largest credit first
}

export interface OwnerResult {
  ownerId: string | null; // null = a team queue
  team: string; // the fundraiser's type, or the queue
  source: OwnerSource;
  alsoOwners: string[]; // other eligible holders, not primary (DECISIONS.md D-OWNER-1)
  skippedDeparted: string[]; // ended or inactive fundraisers passed over
  unknownIds: string[]; // ids named but absent from the fundraisers table
}

function eligible(id: string, ctx: OwnerContext, skipped: string[], unknown: string[]): boolean {
  const f = ctx.fundraisers.get(id);
  if (!f) {
    unknown.push(id);
    return false;
  }
  if (!f.active || (f.endDate !== null && f.endDate < ctx.today)) {
    skipped.push(id);
    return false;
  }
  return true;
}

export function ownerFor(kind: ObligationKind, ctx: OwnerContext, p: Params = DEFAULTS): OwnerResult {
  const skipped: string[] = [];
  const unknown: string[] = [];
  if (kind === 'hq_letter') {
    return { ownerId: null, team: 'Support', source: 'support_queue', alsoOwners: [], skippedDeparted: [], unknownIds: [] };
  }

  const credited = [...new Set(ctx.giftFundraiserIds)].filter((id) => eligible(id, ctx, skipped, unknown));
  if (credited.length) {
    return { ownerId: credited[0], team: ctx.fundraisers.get(credited[0])!.type, source: 'gift_credit', alsoOwners: credited.slice(1), skippedDeparted: skipped, unknownIds: unknown };
  }

  const rank = (type: string) => {
    const i = p.ASSIGNMENT_TYPE_ORDER.indexOf(type);
    return i === -1 ? p.ASSIGNMENT_TYPE_ORDER.length : i;
  };
  const current = ctx.assignments
    .filter((a) => (a.fromDate === null || a.fromDate <= ctx.today) && (a.toDate === null || a.toDate >= ctx.today))
    .sort((a, b) => rank(a.type) - rank(b.type) || Number(a.fundraiserId) - Number(b.fundraiserId));
  const holders = [...new Set(current.map((a) => a.fundraiserId))].filter((id) => eligible(id, ctx, skipped, unknown));
  if (holders.length) {
    return { ownerId: holders[0], team: ctx.fundraisers.get(holders[0])!.type, source: 'assignment', alsoOwners: holders.slice(1), skippedDeparted: skipped, unknownIds: unknown };
  }
  return { ownerId: null, team: p.FALLBACK_TEAM, source: 'partner_care_default', alsoOwners: [], skippedDeparted: skipped, unknownIds: unknown };
}
