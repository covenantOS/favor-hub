// What counts toward a person's own number (the Work badge, Today's work card, the briefing's thank-yous). One rule, 2026-10-13:
// work assigned to them, or work the job they hold is there to pick up. Being an admin adds nothing; admins read everyone's work
// through the Work Center's Everyone filter, and their badge stays their own.
//   actions    the ones that list the person's own fundraiser id; Support also takes the actions with no owner (the No owner lane is theirs)
//   gifts      the ones owed on the person's own partners; Partner Care takes the whole team's partners (the team shares them)
import type { BoardRow } from '../actions/board';
import type { Scope } from './role';

/** The fundraiser ids whose owed gifts are this person's to pick up. */
export function ownerIds(s: Scope | undefined): Set<string> {
  if (!s) return new Set();
  if (s.role === 'partner_care') return new Set(s.fids);
  return s.fid ? new Set([s.fid]) : new Set();
}

export function ownsAction(s: Scope | undefined, r: Pick<BoardRow, 'fundraisers'>): boolean {
  if (!s) return false;
  if (s.fid && r.fundraisers.includes(s.fid)) return true;
  return s.role === 'support' && r.fundraisers.length === 0;
}

/** The open actions that count toward this person's badge. */
export function badgeRows<T extends Pick<BoardRow, 'fundraisers'>>(s: Scope | undefined, rows: T[]): T[] {
  return rows.filter((r) => ownsAction(s, r));
}

/** True when a gift owed a thank-you belongs to this person's pool. */
export function ownsGift(s: Scope | undefined, owners: string[]): boolean {
  const ids = ownerIds(s);
  return owners.some((o) => ids.has(o));
}
