// One onboarding or offboarding run, from ?id=. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { RunPage } from '../../../features/onboarding/RunPage';
import { runQuery, staffQuery } from '../../../features/onboarding/queries';
import { runIdOf } from '../../../features/onboarding/logic';

export const Route = createFileRoute('/onboarding/run/')({
  staticData: { nav: 'onboarding-run', title: 'Onboarding', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  loaderDeps: ({ search }) => ({ id: runIdOf(search) }),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(runQuery(deps.id));
    void context.queryClient.prefetchQuery(staffQuery);
  },
  component: RunPage,
});
