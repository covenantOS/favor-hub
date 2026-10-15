// Admin > People and roles (/admin/people/): who can sign in, role, team, fundraiser link and Work Center access, with an act as preview. Admins only.
// ?filter= opens the list on one filter (pending, blocked, ...). The page is in features/admin-a.
import { createFileRoute } from '@tanstack/react-router';
import { PeoplePage } from '../../../features/admin-a/PeoplePage';
import { brainAccessQuery, isFilter, peopleQuery, peopleSettingsQuery } from '../../../features/admin-a/people.api';

export const Route = createFileRoute('/admin/people/')({
  staticData: { nav: 'admin-people', title: 'People and roles', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(peopleQuery);
    void context.queryClient.prefetchQuery(peopleSettingsQuery);
    void context.queryClient.prefetchQuery(brainAccessQuery);
  },
  component: People,
});

function People() {
  const { filter } = Route.useSearch() as { filter?: unknown };
  return <PeoplePage initialFilter={isFilter(filter) ? filter : ''} />;
}
