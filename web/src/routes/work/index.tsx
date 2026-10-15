// Partners > the Work Center (/work/): Actions and the tabs in its address (?view=gifts, mine, asks, cadence, week, intake, grants).
import { createFileRoute } from '@tanstack/react-router';
import { validateWorkSearch, VIEW_NAV, type WorkSearch } from '../../features/partners/work/search';
import { WorkPage, prefetchWork } from '../../features/partners/work/WorkPage';

export const Route = createFileRoute('/work/')({
  validateSearch: (raw: Record<string, unknown>): WorkSearch => validateWorkSearch(raw),
  loaderDeps: ({ search }) => ({ search }),
  staticData: { nav: 'work', title: 'Actions', layout: 'full', navOf: (s) => VIEW_NAV[String(s.view || 'open')] || VIEW_NAV.open },
  loader: ({ context, deps }) => prefetchWork(context.queryClient, deps.search),
  component: WorkRoute,
});

function WorkRoute() {
  const search = Route.useSearch();
  return <WorkPage search={search} />;
}
