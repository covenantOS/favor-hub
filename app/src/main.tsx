import './styles/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { installHubOv } from './lib/hubOv';
import { CACHE_BUSTER, makePersister, makeQueryClient, watchWrites } from './lib/query';
import { makeRouter } from './router';

installHubOv();
const queryClient = makeQueryClient();
const router = makeRouter(queryClient);
watchWrites(queryClient);

// A write from any helper script (a request approved, a note read) moves a menu count: read the counts a moment after it, as the classic pages do.
const realFetch = window.fetch;
let afterT: ReturnType<typeof setTimeout> | undefined;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const p = realFetch.call(window, input, init);
  const method = String((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const url = String(input instanceof Request ? input.url : input);
    if (/\/api\//.test(url) && !/\/api\/(hub\/nav|auth|clips\/|meet\/|chat\/(?!inbox))/.test(url)) {
      p.then(
        () => {
          clearTimeout(afterT);
          afterT = setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['nav'] }), 1500);
        },
        () => undefined
      );
    }
  }
  return p;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: makePersister(),
        buster: CACHE_BUSTER,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && ['nav', 'today', 'kpi', 'day'].includes(String(q.queryKey[0])) },
      }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>
);
