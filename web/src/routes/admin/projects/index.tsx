// Admin > Projects (/admin/projects/): who can use Projects, the Asana token, the Asana import, the projects FavorOS holds and the Asana sync. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { AdminProjectsPage } from '../../../features/admin-b/AdminProjects';
import { adminProjectsQuery, asanaAdminQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/projects/')({
  staticData: { nav: 'admin-projects', title: 'Projects settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(adminProjectsQuery);
    void context.queryClient.prefetchQuery(asanaAdminQuery);
  },
  component: AdminProjectsPage,
});
