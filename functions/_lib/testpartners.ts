// The two Blackbaud test records for FavorOS testing: 37974 "FavorOS Test Sponsor" (an organization) and 37975 "FavorOS Test
// Recommender" (an individual). Every count, list, scan, letter, statement and Brain answer over the mirror leaves them out.
// This is the one definition. It imports nothing so the node test runner and the lists SQL builders can load it.
export const TEST_PARTNER_IDS: readonly string[] = ['37974', '37975'];

const LIST = TEST_PARTNER_IDS.map((id) => `'${id}'`).join(', ');

/** True for a test record id, however it arrives (string or number). */
export const isTestPartnerRecord = (id: unknown): boolean => TEST_PARTNER_IDS.includes(String(id ?? '').trim());

/** SQL condition that is false for a test record and true for every other row, including a row with no id. `column` is an SQL expression. */
export function notTestPartnerSql(column: string): string {
  return `COALESCE(CAST(${column} AS TEXT), '') NOT IN (${LIST})`;
}

/** Rows whose id (or the id found by `pick`) is not a test record. */
export function withoutTestPartners<T>(rows: T[], pick: (r: T) => unknown = (r) => (r as any)?.id ?? (r as any)?.cid): T[] {
  return rows.filter((r) => !isTestPartnerRecord(pick(r)));
}

/**
 * For feeds that carry a name and a lookup id but not the system record id (the receipts print query from Blackbaud). The two test
 * records are the only ones named "FavorOS Test Sponsor" and "FavorOS Test Recommender", in either name order.
 */
export function isTestPartnerName(...names: unknown[]): boolean {
  return names.some((n) => {
    const s = String(n ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.includes('favoros test') && (s.includes('sponsor') || s.includes('recommender'));
  });
}
