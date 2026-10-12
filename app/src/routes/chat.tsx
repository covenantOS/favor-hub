import { createFileRoute } from '@tanstack/react-router';
import { LegacyPage } from '@/legacy/LegacyPage';
import { ChatPage } from '@/features/chat/ChatPage';

// Native Chat is the page inside the app. The classic page stays at /chat/?classic=1 (served whole by the middleware) and, inside the
// frame, at ?legacy=1.
const Chat = () => (new URLSearchParams(location.search).has('legacy') ? <LegacyPage /> : <ChatPage />);

export const Route = createFileRoute('/chat')({
  component: Chat,
  staticData: { nav: 'chat', title: 'Chat', layout: 'bare', description: 'Channels, direct messages and threads for the Favor team, with clips, meetings, Drive files and Favor Brain in the conversation.' },
});
