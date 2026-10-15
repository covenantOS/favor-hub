// Gifts > Recurring, served by the FavorOS web app. Every recurring gift schedule with the numbers over it, and the changes staff
// make to a schedule's amount, frequency and status.
import { createFileRoute } from '@tanstack/react-router';
import { RecurringPage } from '@/features/recurring/RecurringPage';

export const Route = createFileRoute('/gifts/recurring/')({
  staticData: { nav: 'recurring', title: 'Recurring gifts', layout: 'wide' },
  component: RecurringPage,
});
