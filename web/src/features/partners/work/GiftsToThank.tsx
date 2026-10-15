// Partners > /work/?view=gifts. Placeholder until the port lands.
import type { QueryClient } from '@tanstack/react-query';
import type { WorkSearch } from './search';

export function prefetchGiftsToThank(_qc: QueryClient, _s: WorkSearch): void {}

export function GiftsToThankView({ search: _search }: { search: WorkSearch }) {
  return (
    <section className="h-card wc-sheet" aria-busy="true">
      <div className="h-skel" style={{ height: 360, borderRadius: 18 }} />
    </section>
  );
}
