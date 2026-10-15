// Meetings > Prep: ?m=<meeting id>; without it the next meeting coming up. Port of src/pages/meet/prep.astro.
import { createFileRoute } from '@tanstack/react-router';
import { PrepPage } from '../../../features/meet/prep/PrepPage';
import { prepQuery } from '../../../features/meet/queries';

export const Route = createFileRoute('/meet/prep/')({
  staticData: { nav: 'meet', title: 'Meeting prep', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => ({ m: typeof s.m === 'string' ? s.m : undefined }),
  loaderDeps: ({ search }) => ({ m: search.m }),
  loader: ({ context, deps }) => {
    if (deps.m) void context.queryClient.prefetchQuery(prepQuery(deps.m));
  },
  component: PrepRoute,
});

function PrepRoute() {
  const { m } = Route.useSearch();
  return <PrepPage m={m ?? ''} />;
}
