// Admin > Reports (/admin/reports/): which roles see each report. Admins only (the API refuses everyone else). The page itself is in features/admin-reports.
import { createFileRoute } from '@tanstack/react-router';
import { AdminReportsPage } from '../../../features/admin-reports/AdminReportsPage';
import { adminReportsQuery } from '../../../features/admin-reports/api';

export const Route = createFileRoute('/admin/reports/')({
  staticData: { nav: 'admin-reports', title: 'Reports settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(adminReportsQuery);
  },
  component: AdminReportsPage,
});
