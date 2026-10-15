// Partners > /work/?view=intake. Placeholder until the port lands.
import type { QueryClient } from '@tanstack/react-query';
import type { WorkSearch } from './search';

export function prefetchEntry(_qc: QueryClient, _s: WorkSearch): void {}

export function EntryView({ search: _search }: { search: WorkSearch }) {
  return (
    <section className="h-card wc-sheet" aria-busy="true">
      <div className="h-skel" style={{ height: 360, borderRadius: 18 }} />
    </section>
  );
}
