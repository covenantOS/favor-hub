// Admin > Audit log (/admin/audit/): every settings change, with who made it, when, and the values before and after. Admins only. The page is in features/admin-a.
import { createFileRoute } from '@tanstack/react-router';
import { AuditPage } from '../../../features/admin-a/AuditPage';
import { auditQuery } from '../../../features/admin-a/api';

export const Route = createFileRoute('/admin/audit/')({
  staticData: { nav: 'admin-audit', title: 'Audit log', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(auditQuery(''));
  },
  component: AuditPage,
});
