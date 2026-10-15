// Learn > Learning path: ?p=slug. A path address without ?p= goes to the catalog.
import { createFileRoute, redirect } from '@tanstack/react-router';
import { PathPage } from '../../../features/learn/PathPage';
import { slugOf } from '../../../features/learn/logic';
import { pathQuery } from '../../../features/learn/queries';

export const Route = createFileRoute('/learn/p/')({
  staticData: { nav: 'learn-path', title: 'Learning path', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    if (!slugOf(search.p)) throw redirect({ to: '/learn/catalog/', replace: true });
  },
  loaderDeps: ({ search }) => ({ p: slugOf(search.p) }),
  loader: ({ context, deps }) => {
    if (deps.p) void context.queryClient.prefetchQuery(pathQuery(deps.p));
  },
  component: PathPage,
});
