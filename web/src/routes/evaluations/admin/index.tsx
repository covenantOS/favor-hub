// Evaluation terms: open a term, see who is behind, change supervisors, name the filing folder (?t=ID for one term). HR and admins.
import { createFileRoute } from '@tanstack/react-router';
import { AdminPage } from '../../../features/evaluations/AdminPage';
import { validateAdminSearch, type AdminSearch } from '../../../features/evaluations/logic';

export const Route = createFileRoute('/evaluations/admin/')({
  validateSearch: (raw: Record<string, unknown>): AdminSearch => validateAdminSearch(raw),
  staticData: { nav: 'evals-admin', title: 'Evaluation terms', layout: 'page' },
  component: AdminRoute,
});

function AdminRoute() {
  return <AdminPage search={Route.useSearch()} />;
}
