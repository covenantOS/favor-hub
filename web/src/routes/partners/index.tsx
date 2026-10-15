// Partners > All partners (/partners/): every Blackbaud record, givers or not, with search, filters, saved views, stars, tags and export.
import { createFileRoute } from '@tanstack/react-router';
import { Directory } from '../../features/partners/directory/Directory';
import { dirQuery, menusQuery, recentQuery } from '../../features/partners/api';
import { validateDirSearch, type DirSearch } from '../../lib/route-search';

export const Route = createFileRoute('/partners/')({
  validateSearch: (raw: Record<string, unknown>): DirSearch => validateDirSearch(raw),
  loaderDeps: ({ search }) => ({ search }),
  staticData: { nav: 'partners-all', title: 'All partners', layout: 'full' },
  loader: ({ context, deps }) => {
    const pane = deps.search.pane;
    if (pane === 'recent') void context.queryClient.prefetchQuery(recentQuery);
    else if (!pane) {
      void context.queryClient.prefetchQuery(dirQuery(deps.search, 50));
      void context.queryClient.prefetchQuery(menusQuery);
    }
  },
  component: PartnersRoute,
});

function PartnersRoute() {
  const search = Route.useSearch();
  return <Directory search={search} />;
}
