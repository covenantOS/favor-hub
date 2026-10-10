import type { ActionRecord } from './types.ts';
import { daysBetween } from './dates.ts';

// statusOf: the one definition of "open" (spec 0.1, 5.1 principle 3, 5.5 rule S0).
// The completed FLAG decides. The completed DATE does not: 1,408 review tasks closed by the Database View
// "Complete Actions" import carry completed = true and no completed date, and a date test calls them open.

export type StatusName = 'open' | 'completed' | 'canceled';

export interface StatusInfo {
  status: StatusName;
  pastDue: boolean; // open and due before today (Blackbaud's computed Past due)
  daysPastDue: number; // 0 unless pastDue
  phantomComplete: boolean; // completed, no completed date (the 1,408)
  completedDateForReports: string | null; // the date, else date modified (backfill rule S0, spec 5.2 rules)
  mirrorDisagrees: boolean; // the stored status or computed status says something else (27 rows, spec 4.2)
}

export function statusOf(a: ActionRecord, today: string): StatusInfo {
  let status: StatusName;
  // The same test as openActionSql (functions/_lib/hub/actions.ts): the flag decides, and a computed status of Completed or
  // Canceled, or a stored status of Canceled, also keeps a row out of the open set. tests/actions/status-parity.test.mjs holds the two together.
  const computedNorm = String(a.computedStatus ?? '').toLowerCase().replace(/\s/g, '');
  if (a.completed) status = 'completed';
  else if (String(a.rawStatus ?? '').toLowerCase().startsWith('cancel') || computedNorm.startsWith('cancel')) status = 'canceled';
  else if (computedNorm === 'completed') status = 'completed';
  else status = 'open';

  const pastDue = status === 'open' && a.dueDate !== '' && a.dueDate < today;
  const phantomComplete = status === 'completed' && !a.completedDate;

  // What the mirror's two text fields would say. Compared on the three-way status only.
  const norm = (s: string | null) => {
    const t = String(s ?? '').toLowerCase().replace(/\s/g, '');
    if (t === 'completed') return 'completed';
    if (t.startsWith('cancel')) return 'canceled';
    if (t === 'open' || t === 'pastdue') return 'open';
    return null;
  };
  const stored = norm(a.rawStatus);
  const computed = norm(a.computedStatus);
  const mirrorDisagrees = (stored !== null && stored !== status) || (computed !== null && computed !== status);

  return {
    status,
    pastDue,
    daysPastDue: pastDue ? daysBetween(a.dueDate, today) : 0,
    phantomComplete,
    completedDateForReports: status === 'completed' ? a.completedDate ?? (a.dateModified || null) : null,
    mirrorDisagrees,
  };
}

export const isOpen = (a: ActionRecord, today: string): boolean => statusOf(a, today).status === 'open';
export const isCompleted = (a: ActionRecord, today: string = '9999-12-31'): boolean => statusOf(a, today).status === 'completed';
