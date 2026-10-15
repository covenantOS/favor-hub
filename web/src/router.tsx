import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: 24 * 60 * 60 * 1000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (count, err) => count < 2 && !(err as { status?: number }).status,
      },
    },
  });
  // Hub addresses end in a slash (/projects/); the router keeps them that way.
  const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true, trailingSlash: 'always' });
  // Answers read on the server travel to the browser inside the streamed page, so the browser does not ask for them again.
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
  // Each route names its menu entry and page width, as the classic layout's nav and width props did.
  interface StaticDataRouteOption {
    nav?: string;
    title?: string;
    layout?: 'page' | 'wide' | 'full' | 'bare';
    /** A page with tabs in its address (/work/?view=gifts): the menu entry and title for this address. */
    navOf?: (search: Record<string, unknown>) => { nav: string; title: string } | null;
  }
}
