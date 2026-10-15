// Gifts > Overview, served by the FavorOS web app. The gift day on one screen: six steps, the gifts Blackbaud took in by day, the month's mail
// deposits, the online gifts waiting and the newest thank-you letters. /gifts/ is an exact route (shared/web.ts WEB_EXACT_ROUTES): the letters
// and declines pages under it are still Astro. The reads run through Suspense on the server and in the browser.
import { createFileRoute } from '@tanstack/react-router';
import { GiftsOverview } from '../../features/gifts/GiftsOverview';
import { monthQuery, overviewQuery } from '../../features/gifts/queries';

export const Route = createFileRoute('/gifts/')({
  staticData: { nav: 'gifts-home', title: 'Overview', layout: 'full' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(overviewQuery);
    void context.queryClient.prefetchQuery(monthQuery);
  },
  component: GiftsOverview,
});
