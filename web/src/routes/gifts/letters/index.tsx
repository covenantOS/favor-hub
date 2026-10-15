// Gifts > Thank-you letters, served by the FavorOS web app. Every gift of $5,000 and up with where its handwritten letter stands: To write, Printed,
// Signed, Mailed, Cannot send. Print opens one PDF, Mark mailed logs an HQTY Letter action in Blackbaud with Undo. The read runs through Suspense on the
// server and in the browser. The Astro page stays at ?classic=1.
import { createFileRoute } from '@tanstack/react-router';
import { LettersPage } from '../../../features/gifts/desk/LettersPage';
import { deskSearch } from '../../../features/gifts/desk/kit';
import { hqtyQuery } from '../../../features/gifts/desk/hqty';

export const Route = createFileRoute('/gifts/letters/')({
  staticData: { nav: 'letters', title: 'Thank-you letters', layout: 'full' },
  validateSearch: (s: Record<string, unknown>) => ({ ...s, ...deskSearch(s) }),
  loaderDeps: ({ search }) => ({ as: (search as { as?: string }).as || '' }),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(hqtyQuery(deps.as));
  },
  component: function Letters() {
    return <LettersPage search={Route.useSearch()} />;
  },
});
