// Admin > Blackbaud users (/admin/blackbaud-users/): everyone with a Blackbaud login, and the requests to add, change or deactivate one. Admins only.
// The page is in features/admin-a.
import { createFileRoute } from '@tanstack/react-router';
import { BbUsersPage } from '../../../features/admin-a/BbUsersPage';
import { bbJobsQuery, bbUsersQuery } from '../../../features/admin-a/bbusers.api';

export const Route = createFileRoute('/admin/blackbaud-users/')({
  staticData: { nav: 'admin-bbusers', title: 'Blackbaud users', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(bbUsersQuery);
    void context.queryClient.prefetchQuery(bbJobsQuery);
  },
  component: BbUsersPage,
});
