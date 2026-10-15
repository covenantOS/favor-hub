// Partners > /work/?view=asks. Placeholder until the port lands.
import type { QueryClient } from '@tanstack/react-query';
import type { WorkSearch } from './search';

export function prefetchAsks(_qc: QueryClient, _s: WorkSearch): void {}

export function AsksView({ search: _search }: { search: WorkSearch }) {
  return (
    <section className="h-card wc-sheet" aria-busy="true">
      <div className="h-skel" style={{ height: 360, borderRadius: 18 }} />
    </section>
  );
}
