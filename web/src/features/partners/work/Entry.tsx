// Partners > /work/?view=intake: Entry, where Support matches the week's contacts to partners and sends them to Blackbaud.
import { Suspense } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Skel } from './actions/ui';
import { EntryBody, EntryBoundary } from './actions/entry/EntryPage';
import { entryQuery } from './actions/entry/types';
import { asOf } from './actions/useWork';
import './actions/entry/entry.css';
import type { WorkSearch } from './search';
import { WorkHeader } from './WorkHeader';

export function prefetchEntry(qc: QueryClient, s: WorkSearch): void {
  void qc.prefetchQuery(entryQuery('', asOf(s)));
}

/** The shape of the page while Entry reads: the person strip, the deadline card and the list, so nothing moves when it arrives. */
function EntrySkel() {
  return (
    <div aria-busy="true">
      <div className="wc-owners" style={{ minHeight: 36 }}>
        {[132, 124, 124, 112, 130, 140].map((w, i) => (
          <span key={i} className="wc-owner" aria-hidden="true">
            <i className="h-skel" style={{ display: 'inline-block', width: w, height: 14, borderRadius: 7 }} />
          </span>
        ))}
      </div>
      <section className="h-card wc-clock" aria-hidden="true" style={{ minHeight: 92 }} />
      <Skel rows={5} id="wc-intake" />
    </div>
  );
}

export function EntryView({ search }: { search: WorkSearch }) {
  const qc = useQueryClient();
  const as = asOf(search);
  return (
    <>
      <WorkHeader search={search} />
      <EntryBoundary onRetry={() => void qc.resetQueries({ queryKey: ['work', 'entry'] })}>
        <Suspense fallback={<EntrySkel />}>
          <EntryBody as={as} standin={search.standin === '1' || search.standin === 1} />
        </Suspense>
      </EntryBoundary>
    </>
  );
}
