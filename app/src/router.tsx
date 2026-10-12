import { createRouter } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import type { RouteMeta } from './shell/Shell';

export interface RouterContext {
  queryClient: QueryClient;
}

export function makeRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: false });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
  // Each route says which menu entry it belongs to and how wide its page is: staticData: { nav: 'home', title: 'Today' }.
  interface StaticDataRouteOption extends RouteMeta {}
}
