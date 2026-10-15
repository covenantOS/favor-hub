// The partner page. Placeholder until the port lands.
import type { QueryClient } from '@tanstack/react-query';

export function prefetchPartner(_qc: QueryClient, _id: string): void {}

export function PartnerPage({ id }: { id: string }) {
  return (
    <section className="h-card pp-full" data-id={id}>
      <div className="h-skel" style={{ height: 480, borderRadius: 18 }} />
    </section>
  );
}
