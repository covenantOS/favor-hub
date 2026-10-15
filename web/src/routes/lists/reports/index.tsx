// Reporting > Standard reports (/lists/reports/): giving, credit, partners and team reports with a period picker, a check against the KPI
// dashboard and a drill to the rows. ?r=<report id> opens one report. The page itself is in features/lists.
import { createFileRoute } from '@tanstack/react-router';
import { ReportsError, ReportsPage, type ReportsSearch } from '../../../features/lists/ReportsPage';
import { prefetchReports } from '../../../features/lists/api';

export const Route = createFileRoute('/lists/reports/')({
  validateSearch: (raw: Record<string, unknown>): ReportsSearch => (typeof raw.r === 'string' && raw.r ? { r: raw.r } : {}),
  loaderDeps: ({ search }) => ({ r: search.r }),
  staticData: { nav: 'list-reports', title: 'Standard reports', layout: 'full' },
  loader: ({ context, deps }) => prefetchReports(context.queryClient, deps.r),
  component: ReportsRoute,
  errorComponent: ({ error }) => <ReportsError message={(error as Error).message} />,
});

function ReportsRoute() {
  return <ReportsPage search={Route.useSearch()} />;
}
