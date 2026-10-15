// Who is reading decides which articles show: an article meant only for admins and approvers stays out of everyone else's lists,
// and the "For your work" picks come from the same tags. The person comes from the menu answer; until it arrives the lists draw
// with the admin-only articles left out, so an admin sees them appear and nobody else sees anything move.
import { Suspense, type ReactNode } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { navQuery } from '../../lib/queries';

export type Tags = Set<string>;

export function tagsOf(access: Record<string, unknown> | undefined, kpiTeams: string[] | undefined): Tags {
  const a = access || {};
  const teams = kpiTeams || [];
  const t = new Set<string>(['all', ...teams]);
  if (a.admin) t.add('admin');
  if (a.approver || a.expenseLog) t.add('approver');
  if (a.kpi) t.add('kpi');
  if (teams.length >= 5) t.add('leader');
  return t;
}

export const adminOnly = (f: string[]): boolean => f.length > 0 && f.every((x) => x === 'admin' || x === 'approver');

/** True when this article should be drawn for a person with these tags (null: the person is not known yet). */
export const visibleFor = (f: string[], tags: Tags | null): boolean => !adminOnly(f) || (!!tags && f.some((x) => tags.has(x)));

function Tagged({ children }: { children: (tags: Tags) => ReactNode }) {
  const { data } = useSuspenseQuery(navQuery);
  return <>{children(tagsOf(data.access as Record<string, unknown>, data.kpiTeams))}</>;
}

/** Draws `children(tags)` once the menu answer is in, and `children(null)` while it is not. */
export function Gate({ children }: { children: (tags: Tags | null) => ReactNode }) {
  return (
    <Suspense fallback={<>{children(null)}</>}>
      <Tagged>{children}</Tagged>
    </Suspense>
  );
}
