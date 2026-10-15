// Staff > Expenses: your requests, a new request, and for approvers the log and settings. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { ExpensesPage } from '../../features/expenses/ExpensesPage';
import { mineQuery } from '../../features/expenses/queries';

export const Route = createFileRoute('/expenses/')({
  staticData: { nav: 'expenses', title: 'Expenses', layout: 'full' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(mineQuery);
  },
  component: ExpensesPage,
});
