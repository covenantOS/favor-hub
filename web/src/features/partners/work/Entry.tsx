// Partners > /work/?view=intake. Placeholder until the port lands.
import type { QueryClient } from '@tanstack/react-query';
import type { WorkSearch } from './search';
import { WorkHeader } from './WorkHeader';

export function prefetchEntry(_qc: QueryClient, _s: WorkSearch): void {}

export function EntryView({ search }: { search: WorkSearch }) {
  return (
    <>
      <WorkHeader search={search} />
    </>
  );
}
