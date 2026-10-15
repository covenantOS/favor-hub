// Admin > Gifts (/admin/gifts/): who opens Gift entry and sends to Blackbaud, the second approval amount, and Online gifts writes. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { GiftsSettingsPage } from '../../../features/admin-b/GiftsSettings';
import { giftEntrySettingsQuery, otherGiftsSettingsQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/gifts/')({
  staticData: { nav: 'admin-gifts', title: 'Gifts settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(giftEntrySettingsQuery);
    void context.queryClient.prefetchQuery(otherGiftsSettingsQuery);
  },
  component: GiftsSettingsPage,
});
