// Learn > Manage (/learn/admin/): courses, paths, assigning and reports for admins and HR. The tab is in the address (?tab=), and
// ?course= or ?path= open Assign on that course or path.
import { createFileRoute } from '@tanstack/react-router';
import { ManagePage, type ManageSearch } from '../../../features/learn-admin/ManagePage';
import { overviewQuery } from '../../../features/learn-admin/queries';

export const Route = createFileRoute('/learn/admin/')({
  validateSearch: (raw: Record<string, unknown>): ManageSearch => {
    const out: ManageSearch = {};
    for (const k of ['tab', 'course', 'path'] as const) if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k] as string;
    return out;
  },
  staticData: { nav: 'learn-admin', title: 'Manage learning', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(overviewQuery);
  },
  component: Page,
});

function Page() {
  return <ManagePage search={Route.useSearch()} />;
}
