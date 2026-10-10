import type { ActionRecord } from './types.ts';
import type { Params } from './params.ts';
import { DEFAULTS } from './params.ts';
import { REVIEW_TYPE } from './contact-types.ts';
import { statusOf } from './status.ts';
import { daysBetween } from './dates.ts';

// staleClass: where an action sits on the aging ladder (spec 5.5 rules S0, S3 and S7).
// Nothing is closed here. The class only says what the cleanup job may propose.

export type StaleClass =
  | 'completed' // done, including the phantom completes (S0)
  | 'not_due' // open and not yet due
  | 'overdue' // past due, up to STALE_DAYS
  | 'stale' // past due over STALE_DAYS, still counted
  | 'close_proposal' // past due over CLOSE_PROPOSAL_DAYS: weekly one-tap proposal to the owner
  | 'review_escalate'; // an open review task past REVIEW_ESCALATE_DAYS goes to leadership (S7)

export interface StaleInfo {
  class: StaleClass;
  daysPastDue: number;
  overYear: boolean; // past due more than OVER_YEAR_DAYS (spec 2.5 reports 14)
  neverAutoClose: boolean; // tied to a gift of NEVER_AUTOCLOSE_GIFT_AMOUNT or more (S3)
}

export interface StaleContext {
  today: string;
  giftAmount?: number | null; // the gift the task is about, when known
}

export function staleClass(a: ActionRecord, ctx: StaleContext, p: Params = DEFAULTS): StaleInfo {
  const s = statusOf(a, ctx.today);
  const neverAutoClose = (ctx.giftAmount ?? 0) >= p.NEVER_AUTOCLOSE_GIFT_AMOUNT;
  if (s.status !== 'open') return { class: 'completed', daysPastDue: 0, overYear: false, neverAutoClose };
  const days = s.daysPastDue;
  const overYear = days > p.OVER_YEAR_DAYS;
  let cls: StaleClass;
  if (days <= 0) cls = 'not_due';
  else if (a.type === REVIEW_TYPE && days > p.REVIEW_ESCALATE_DAYS) cls = 'review_escalate';
  else if (days > p.CLOSE_PROPOSAL_DAYS) cls = 'close_proposal';
  else if (days > p.STALE_DAYS) cls = 'stale';
  else cls = 'overdue';
  return { class: cls, daysPastDue: days, overYear, neverAutoClose };
}

/** A close proposal sent on proposedOn escalates to the team lead when the owner has not answered in ESCALATE_AFTER_DAYS. */
export function escalationDue(proposedOn: string, today: string, answered: boolean, p: Params = DEFAULTS): boolean {
  return !answered && daysBetween(proposedOn, today) >= p.ESCALATE_AFTER_DAYS;
}
