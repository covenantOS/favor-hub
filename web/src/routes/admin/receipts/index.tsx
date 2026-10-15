// Admin > Receipts (/admin/receipts/): the receipt window and the morning email line. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { ReceiptsSettingsPage } from '../../../features/admin-b/Pages';
import { settingsQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/receipts/')({
  staticData: { nav: 'admin-receipts', title: 'Receipts settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(settingsQuery('receipts'));
  },
  component: ReceiptsSettingsPage,
});
