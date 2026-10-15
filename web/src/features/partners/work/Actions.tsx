// Partners > /work/?view=open (and ty, opps, stale, recent, giftimages). Header first; the lists follow.
import type { QueryClient } from '@tanstack/react-query';
import type { WorkSearch } from './search';
import { WorkHeader } from './WorkHeader';
import { boardQuery, codesQuery, gateQuery, recentQuery, startQuery, viewsQuery } from './actions/queries';
import { asOf } from './actions/useWork';
import { Skel } from './actions/ui';

export function prefetchActions(qc: QueryClient, s: WorkSearch): void {
  const as = asOf(s);
  void qc.prefetchQuery(gateQuery(as));
  void qc.prefetchQuery(boardQuery(as));
  void qc.prefetchQuery(recentQuery(as));
  void qc.prefetchQuery(startQuery(as));
  void qc.prefetchQuery(codesQuery(as));
  void qc.prefetchQuery(viewsQuery(as));
}

export function ActionsView({ search }: { search: WorkSearch }) {
  return (
    <>
      <WorkHeader search={search} />
      <Skel rows={8} id="wc-board" />
    </>
  );
}
