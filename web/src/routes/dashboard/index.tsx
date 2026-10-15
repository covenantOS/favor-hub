// Reporting > Executive and the team tabs (/dashboard/): the KPI dashboard inside FavorOS, in a frame. ?page=<path> names the dashboard page
// (%2Frdds is the RDD team); no page is Executive. The page itself is in features/dashboard.
import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '../../features/dashboard/DashboardPage';
import { navIdOf, pageOf } from '../../features/dashboard/pages';

export const Route = createFileRoute('/dashboard/')({
  validateSearch: (raw: Record<string, unknown>): { page?: string } => {
    const p = pageOf(raw.page);
    return p === '/' ? {} : { page: p };
  },
  // The header keeps the area name and the menu follows the page; the team pages are entries of the Reporting menu.
  staticData: { nav: 'kpi', title: 'Reporting', layout: 'wide', navOf: (s) => ({ nav: navIdOf(pageOf(s.page)), title: 'Reporting' }) },
  component: DashboardRoute,
});

function DashboardRoute() {
  const { page } = Route.useSearch();
  return <DashboardPage page={pageOf(page)} />;
}
