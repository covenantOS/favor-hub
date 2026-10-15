// Data care: partners who gave this year with no mailing address, and possible duplicate records side by side.
import { createFileRoute } from '@tanstack/react-router';
import { DataCare } from '../../features/data-care/DataCare';
import { summaryQuery, pairsQuery } from '../../features/data-care/queries';

export const Route = createFileRoute('/data-care/')({
  staticData: { nav: 'partners-datacare', title: 'Data care', layout: 'wide' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(summaryQuery);
    void context.queryClient.prefetchQuery(pairsQuery('review'));
  },
  component: DataCare,
});
