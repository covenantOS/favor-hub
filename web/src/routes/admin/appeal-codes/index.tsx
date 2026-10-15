// Admin > Appeal codes (/admin/appeal-codes/): build an appeal code from the scheme, create it in Blackbaud, and keep the list of funds and campaigns waiting. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { AppealCodesPage } from '../../../features/admin-b/AppealCodes';
import { appealsQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/appeal-codes/')({
  staticData: { nav: 'admin-appeals', title: 'Appeal codes', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(appealsQuery);
  },
  component: AppealCodesPage,
});
