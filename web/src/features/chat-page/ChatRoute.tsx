// Chat (/chat/) in the web app. The screen is app/src/features/chat (ChatPage), the same one app2 draws: it keeps a live WebSocket, a
// local draft store and the huddle ring, so it is client-only. The server draws the frame and Chat's first paint (the classic page's own,
// generated from chat-ui.js); the page loads after hydration and takes its place.
import { lazy, Suspense } from 'react';
import { ClientOnly } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import '@hub/styles/brain.css';
import '@hub/styles/chat.css';
import '@hub/styles/crit-chat.css';
import '@hub/styles/q3-chat.css';
import '@hub/styles/huddle.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/chat2.css';
import '@hub/styles/break-ui.css';
import '@/features/chat/chat-native.css';
import '@/features/chat/live';
import { CHAT_BOOT_HTML } from './bootHtml';

// The page's code starts downloading the moment this file runs (in the browser), not after hydration has drawn the skeleton.
const load = () => import('@/features/chat/ChatPage').then((m) => ({ default: m.ChatPage }));
const early = typeof window !== 'undefined' ? load() : null;
const ChatPage = lazy(() => early ?? load());

/** The first paint at the screen's final size. */
export function ChatSkeleton() {
  return <div id="chat-root" className="ch" data-view="list" data-boot="" aria-busy="true" dangerouslySetInnerHTML={{ __html: CHAT_BOOT_HTML }} />;
}

export function ChatRoute() {
  return (
    <ErrorBoundary label="Chat could not load." className="h-card">
      <ClientOnly fallback={<ChatSkeleton />}>
        <Suspense fallback={<ChatSkeleton />}>
          <ChatPage />
        </Suspense>
      </ClientOnly>
    </ErrorBoundary>
  );
}
