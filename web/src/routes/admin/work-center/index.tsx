// Admin > Work Center (/admin/work-center/): Blackbaud calls a day, morning email start dates, where each role starts, tags and cadence rules. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { WorkCenterSettingsPage } from '../../../features/admin-b/Pages';
import { settingsQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/work-center/')({
  staticData: { nav: 'admin-work', title: 'Work Center settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(settingsQuery('work'));
  },
  component: WorkCenterSettingsPage,
});
