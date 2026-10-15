import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: false, refetchOnWindowFocus: true } } });
  const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true, trailingSlash: 'always' });
  // Answers read on the server travel to the browser inside the streamed page, so the browser does not ask for them again.
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
  interface StaticDataRouteOption {
    nav?: string;
    title?: string;
    layout?: 'page' | 'wide' | 'full' | 'bare';
  }
}
