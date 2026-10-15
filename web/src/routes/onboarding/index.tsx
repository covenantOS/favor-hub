// Staff > Onboarding: runs in progress, the start sheet, the checklist template and the duty owners. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { OnboardingPage } from '../../features/onboarding/OnboardingPage';
import { listQuery } from '../../features/onboarding/queries';

export const Route = createFileRoute('/onboarding/')({
  staticData: { nav: 'onboarding', title: 'Onboarding', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(listQuery);
  },
  component: OnboardingPage,
});
