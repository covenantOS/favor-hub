// Reports (/reports/): the list of reports this person may open and one report at /reports/?r=<id>&<filters>. The page itself is in features/reports.
import { createFileRoute } from '@tanstack/react-router';
import { ReportsPage } from '../../features/reports/ReportsPage';
import { askedOf, listQuery, reportQuery } from '../../features/reports/api';

export const Route = createFileRoute('/reports/')({
  // The filters are whatever the address says; the server checks each one against the report's own filter list.
  validateSearch: (raw: Record<string, unknown>) => raw,
  staticData: { nav: 'reports', title: 'Reports', layout: 'full' },
  loader: ({ context, location }) => {
    // Read once on the way in. A filter changed on the page is read by the page, so this loader does not depend on the search.
    const { id, asked } = askedOf(location.searchStr);
    if (id) void context.queryClient.prefetchQuery(reportQuery(id, asked));
    else void context.queryClient.prefetchQuery(listQuery);
  },
  component: ReportsPage,
});
