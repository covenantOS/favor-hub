// Gifts > Online gifts, served by the FavorOS web app. Each online gift with the partner's comment and the designation read from it, Approve per gift
// or all at once, and the Blackbaud batches still waiting for Approve in Blackbaud. ?days= (1, 3, 7, 14), ?gift=ID and ?test=1 work as on the classic page.
import { createFileRoute } from '@tanstack/react-router';
import { OnlineGiftsError, OnlineGiftsPage } from '../../features/gifts/OnlineGifts';
import { onlineQuery } from '../../features/gifts/online';
import { ogSearch } from '../../lib/route-search';

export const Route = createFileRoute('/online-gifts/')({
  staticData: { nav: 'online-gifts', title: 'Online gifts', layout: 'full' },
  validateSearch: (s: Record<string, unknown>) => s,
  loaderDeps: ({ search }) => ogSearch(search),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(onlineQuery(deps));
  },
  component: OnlineGiftsPage,
  errorComponent: ({ error }) => <OnlineGiftsError message={(error as Error).message || 'The online gifts did not load.'} />,
});
