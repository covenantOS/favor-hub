import './styles/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { installHubOv } from './lib/hubOv';
import { makeQueryClient, persistCache, restoreCache, watchWrites } from './lib/query';
import { afterPaint } from './lib/legacy';
import { makeRouter } from './router';

installHubOv();
const queryClient = makeQueryClient();
restoreCache(queryClient);
persistCache(queryClient);
const router = makeRouter(queryClient);
watchWrites(queryClient);

// Styles the first screen does not need (partner drawer, request tasks, tour, gifts, records) load after it has painted.
afterPaint(() => void import('./styles/lazy'));

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
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
