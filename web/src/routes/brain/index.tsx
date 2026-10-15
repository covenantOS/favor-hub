// Favor Brain (/brain/): your chats, the conversation and its answers, the steps behind each answer as it is made. The page is
// app/src/features/brain (shared with the dock's Favor Brain tab); this file reads the first frame on the server.
import { Suspense, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { BrainPage } from '@/features/brain/BrainPage';
import { historyQuery, meQuery, threadQuery } from '@/features/brain/api';
import { hubGet } from '../../lib/hub';

const get = (path: string) => hubGet(path);
let loaded = false;
const chatOf = (search: Record<string, unknown>) => {
  const c = String(search.c || '');
  return /^c_[a-z0-9]{4,16}$/.test(c) ? c : '';
};

export const Route = createFileRoute('/brain/')({
  staticData: { nav: 'brain', title: 'Favor Brain', layout: 'bare' },
  validateSearch: (s: Record<string, unknown>) => s,
  loaderDeps: ({ search }) => ({ c: chatOf(search) }),
  loader: ({ context, deps }) => {
    // The page keeps ?c= in step with the open chat itself; after the first load a new ?c= is the page's own doing, not a read to make.
    if (typeof window !== 'undefined' && loaded) return;
    loaded = true;
    void context.queryClient.prefetchQuery(meQuery(get));
    void context.queryClient.prefetchQuery(historyQuery(get));
    void context.queryClient.prefetchQuery(threadQuery(get, deps.c || '-'));
  },
  component: Brain,
});

function Brain() {
  // The chat in the address when the page opened. Later changes to ?c= come from the page itself (BrainPage keeps it in step).
  const deps = Route.useLoaderDeps();
  const [c] = useState(deps.c);
  return (
    <ErrorBoundary label="Favor Brain could not load." className="h-card">
      <Suspense fallback={<BrainSkeleton />}>
        <BrainPage get={get} c={c} />
      </Suspense>
    </ErrorBoundary>
  );
}

/** The page's frame while the chats load: rail, bar and the ask box at their final size. */
function BrainSkeleton() {
  return (
    <div className="bc-root">
      <div className="bc-app" data-ready="0">
        <aside className="bc-rail" aria-label="Your chats">
          <div className="bc-rail__in">
            <div className="r2t-skel" style={{ height: 40, borderRadius: 999 }} />
            <div className="r2t-skel" style={{ height: 36, borderRadius: 999, marginTop: 10 }} />
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="r2t-skel" style={{ height: 44, borderRadius: 12, marginTop: 8 }} />
            ))}
          </div>
        </aside>
        <section className="bc-pane" aria-label="Chat">
          <div className="bc-bar" />
          <div className="bc-scroll" />
          <div className="bc-dock">
            <div className="bc-dock__in">
              <div className="bc-compose" style={{ height: 58 }} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
