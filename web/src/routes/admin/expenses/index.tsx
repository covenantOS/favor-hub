// Admin > Expenses (/admin/expenses/): the approver schedule, substitutes and who can open the expense log. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { ExpensesSettingsPage } from '../../../features/admin-b/Pages';
import { settingsQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/expenses/')({
  staticData: { nav: 'admin-expenses', title: 'Expenses settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(settingsQuery('expenses'));
  },
  component: ExpensesSettingsPage,
});
