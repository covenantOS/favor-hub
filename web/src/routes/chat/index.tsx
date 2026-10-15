// Chat (/chat/): channels, direct messages, threads, reactions, mentions, files from Drive, clips, meeting cards and Favor Brain.
// The page is app/src/features/chat; its reads and the live socket run in the browser.
import { createFileRoute } from '@tanstack/react-router';
import { ChatRoute } from '../../features/chat-page/ChatRoute';

export const Route = createFileRoute('/chat/')({
  staticData: { nav: 'chat', title: 'Chat', layout: 'bare' },
  component: ChatRoute,
});
