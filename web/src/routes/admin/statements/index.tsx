// Admin > Giving statements (/admin/statements/): the wording on every statement, the print file size, the copy folder and the email switch. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { StatementsSettingsPage } from '../../../features/admin-b/Pages';
import { settingsQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/statements/')({
  staticData: { nav: 'admin-statements', title: 'Giving statements settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(settingsQuery('statements'));
  },
  component: StatementsSettingsPage,
});
