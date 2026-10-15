// Meetings > Series: ?id=<series id>. One repeating series, its upcoming and past meetings. Port of src/pages/meet/series.astro.
import { createFileRoute } from '@tanstack/react-router';
import { SeriesPage } from '../../../features/meet/series/SeriesPage';
import { seriesQuery } from '../../../features/meet/queries';

export const Route = createFileRoute('/meet/series/')({
  staticData: { nav: 'meet', title: 'Series', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => ({ id: typeof s.id === 'string' ? s.id : undefined }),
  loaderDeps: ({ search }) => ({ id: search.id }),
  loader: ({ context, deps }) => {
    if (deps.id) void context.queryClient.prefetchQuery(seriesQuery(deps.id));
  },
  component: SeriesRoute,
});

function SeriesRoute() {
  const { id } = Route.useSearch();
  return <SeriesPage id={id ?? ''} />;
}
