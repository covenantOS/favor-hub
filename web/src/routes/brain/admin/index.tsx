// Brain admin (/brain/admin/): access requests, who sees what, every question asked, names and iWave. Open to the Brain's admin only (the Brain checks the
// email on every call). The page is in features/admin-a.
import { createFileRoute } from '@tanstack/react-router';
import { BrainAdminPage } from '../../../features/admin-a/BrainAdminPage';
import { brainNamesQuery, brainOverviewQuery, brainIwaveQuery } from '../../../features/admin-a/brain-admin.api';

export const Route = createFileRoute('/brain/admin/')({
  staticData: { nav: 'brain-admin', title: 'Brain admin', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(brainOverviewQuery);
    void context.queryClient.prefetchQuery(brainNamesQuery);
    void context.queryClient.prefetchQuery(brainIwaveQuery);
  },
  component: BrainAdminPage,
});
