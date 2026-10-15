// Admin > Meetings (/admin/meetings/): who can use Meetings, guests, meeting size, the recording folder and the reminder lead time. Admins only (the API refuses everyone else).
import { createFileRoute } from '@tanstack/react-router';
import { MeetingsSettingsPage } from '../../../features/meet/admin/MeetingsSettingsPage';
import { settingsQuery } from '../../../features/admin-settings/api';

export const Route = createFileRoute('/admin/meetings/')({
  staticData: { nav: 'admin-meetings', title: 'Meetings settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(settingsQuery('meetings'));
  },
  component: MeetingsSettingsPage,
});
