// Gifts > Declines, served by the FavorOS web app. Declined monthly payments and zeroed gifts with the card processor's reason, and the follow-up each
// one needs. Logging a follow-up saves an Information Update action on the partner, sent to Blackbaud with Undo. The Astro page stays at ?classic=1.
import { createFileRoute } from '@tanstack/react-router';
import { DeclinesPage } from '../../../features/gifts/desk/DeclinesPage';
import { deskSearch } from '../../../features/gifts/desk/kit';
import { declinesQuery } from '../../../features/gifts/desk/declines';

export const Route = createFileRoute('/gifts/declines/')({
  staticData: { nav: 'declines', title: 'Declines', layout: 'full' },
  validateSearch: (s: Record<string, unknown>) => ({ ...s, ...deskSearch(s) }),
  loaderDeps: ({ search }) => ({ as: (search as { as?: string }).as || '' }),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(declinesQuery(deps.as));
  },
  component: function Declines() {
    return <DeclinesPage search={Route.useSearch()} />;
  },
});
