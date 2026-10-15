// What counts as a note from staff to read. The Today card, the Feedback menu badge and the admin's count all use this one rule.
// The Feedback page still lists every row, so the triage list can show the Brain's automatic "no answer matched" logs.
//
// A note is a row a person wrote: it has comment text, it is not an automatic log (rating 'unrouted'), and the sender is not
// a test account. A bare helpful or unhelpful tap is a rating, not a note.
import { notTesterSql, isHiddenAccount } from '../testuser';

/** SQL for the rows that are real notes. Prefix with AND or use inside WHERE. Needs the columns rating, comment and email. */
export const REAL_NOTE_SQL =
  `COALESCE(rating, '') <> 'unrouted' AND trim(COALESCE(comment, '')) <> '' AND ${notTesterSql('email')} AND lower(email) NOT LIKE 'tester%@favorintl.org'`;

/** The same rule in code, for tests and for rows already in memory. */
export function isRealNote(row: { rating?: string | null; comment?: string | null; email?: string | null }): boolean {
  const email = String(row.email || '').trim().toLowerCase();
  return (
    String(row.rating || '') !== 'unrouted' &&
    String(row.comment || '').trim() !== '' &&
    !isHiddenAccount(email) &&
    !/^tester[^@]*@favorintl\.org$/.test(email)
  );
}
