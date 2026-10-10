// The contact-type table that replaces four hard-coded lists (spec 5.1 principle 4, ACT-059).
// Each flag reproduces one consumer's list exactly as read on 2026-10-09 (tools/check_contact_types.ts proves it).
// The table lives only in this package. It is not written into any repository.

export interface ContactTypeRow {
  type: string;
  counts_for_portfolio: boolean; // Q:\work\favor-astro\sop-audit\gift_coding.py:31 CONTACT_TYPES (P versus W evidence)
  counts_for_first_gift: boolean; // re-nxt-cloud-sync src/follow-ups/followups.js:30 CONTACT_TYPES (origin/native)
  counts_for_foundation_contact: boolean; // favor-hub functions/_lib/foundations/blackbaud.ts:30 CONTACT_TYPES
  kpi_group: string | null; // re-nxt-cloud-sync src/kpi-builders/rdd-kpis.js:268 (action_type = 'RDD Action')
}

const row = (type: string, p: boolean, f: boolean, fo: boolean, kpi: string | null): ContactTypeRow => ({
  type,
  counts_for_portfolio: p,
  counts_for_first_gift: f,
  counts_for_foundation_contact: fo,
  kpi_group: kpi,
});

export const CONTACT_TYPE_TABLE: ContactTypeRow[] = [
  row('RDD Action', true, true, true, 'rdd'),
  row('PC Action', true, true, false, null),
  row('CED Action', true, true, false, null),
  row('Carole Action', true, true, false, null),
  row('Terry Action', true, false, false, null),
  row('Grants Action', true, true, true, null),
  row('RESERVED (HQTY Letter)', false, true, false, null),
  row('RESERVED (Office Staff Communication Exchanged)', false, true, false, null),
];

export type ContactFlag = 'counts_for_portfolio' | 'counts_for_first_gift' | 'counts_for_foundation_contact';

export function contactTypeSet(flag: ContactFlag, table: ContactTypeRow[] = CONTACT_TYPE_TABLE): Set<string> {
  return new Set(table.filter((r) => r[flag]).map((r) => r.type));
}

export const HQTY_TYPE = 'RESERVED (HQTY Letter)';
export const FOLLOW_UP_TYPE = 'RESERVED (Follow Up - New Gift Received)';
export const REVIEW_TYPE = 'RESERVED (Review New Constituent Record)';
/** The four types the spec calls the thank-you family (spec 2.2 point b). */
export const THANK_YOU_FAMILY = new Set(['RDD Action', 'PC Action', 'CED Action', FOLLOW_UP_TYPE]);
