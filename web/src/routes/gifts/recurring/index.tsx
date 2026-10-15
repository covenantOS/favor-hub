// Gifts > Recurring, served by the FavorOS web app. Every recurring gift schedule with the numbers over it, and the changes staff
// make to a schedule: amount, frequency, status, skip one charge. The read runs through Suspense on the server and in the browser.
import { createFileRoute } from '@tanstack/react-router';
import { RecurringPage } from '@/features/recurring/RecurringPage';
import { recurringHubQuery } from '../../../lib/queries';

export const Route = createFileRoute('/gifts/recurring/')({
  staticData: { nav: 'recurring', title: 'Recurring gifts', layout: 'wide' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(recurringHubQuery);
  },
  component: () => <RecurringPage query={recurringHubQuery} />,
});
