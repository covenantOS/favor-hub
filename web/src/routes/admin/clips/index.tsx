// Admin > Clips (/admin/clips/): storage for each person and who can record. Admins only (the API refuses everyone else).
import { createFileRoute } from '@tanstack/react-router';
import { AdminClipsPage } from '../../../features/clips/AdminClipsPage';
import { clipsSettingsQuery } from '../../../features/clips/queries';

export const Route = createFileRoute('/admin/clips/')({
  staticData: { nav: 'admin-clips', title: 'Clips settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(clipsSettingsQuery);
  },
  component: AdminClipsPage,
});
