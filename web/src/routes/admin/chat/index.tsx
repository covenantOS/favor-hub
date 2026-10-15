// Admin > Chat (/admin/chat/): who can use Chat, Learn and Mail, the request board's notices. The page itself is in features/admin-b.
import { createFileRoute } from '@tanstack/react-router';
import { ChatSettingsPage } from '../../../features/admin-b/Pages';
import { settingsQuery } from '../../../features/admin-b/api';

export const Route = createFileRoute('/admin/chat/')({
  staticData: { nav: 'admin-chat', title: 'Chat settings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(settingsQuery('chat'));
  },
  component: ChatSettingsPage,
});
