// Admin > Overview (/admin/): health of the jobs behind FavorOS, a link to every settings page, and the last five settings changes. Admins only (every read
// behind it refuses everyone else). The page itself is in features/admin-a. /admin/ is an exact route (shared/web.ts WEB_EXACT_ROUTES): each settings page
// under it is listed on its own.
import { createFileRoute } from '@tanstack/react-router';
import { OverviewPage } from '../../features/admin-a/OverviewPage';
import { healthQuery, recentAuditQuery } from '../../features/admin-a/api';

export const Route = createFileRoute('/admin/')({
  staticData: { nav: 'admin-home', title: 'Admin', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(healthQuery);
    void context.queryClient.prefetchQuery(recentAuditQuery);
  },
  component: OverviewPage,
});
