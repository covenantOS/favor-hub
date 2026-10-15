// Foundations. Placeholder until the port lands.
import type { QueryClient } from '@tanstack/react-query';

export function prefetchFoundations(_qc: QueryClient): void {}

export function FoundationsPage() {
  return (
    <section className="h-card" aria-busy="true">
      <div className="h-skel" style={{ height: 480, borderRadius: 18 }} />
    </section>
  );
}
