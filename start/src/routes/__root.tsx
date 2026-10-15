/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { PocShell } from '../poc/PocShell';
import { navQuery } from '../poc/queries';
import css from '../poc/styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0, viewport-fit=cover' },
      { name: 'robots', content: 'noindex' },
      { name: 'theme-color', content: '#f4efe0' },
      { title: 'FavorOS (React preview)' },
    ],
    links: [
      { rel: 'preload', href: '/fonts/inter-var.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'preload', href: '/fonts/playfair-500.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: css },
      { rel: 'icon', type: 'image/png', href: '/images/favor-icon.png' },
    ],
  }),
  // The menu answer is asked for on the server before rendering starts and streams into the page when it arrives (not awaited).
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(navQuery);
  },
  shellComponent: Document,
  component: Root,
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <style>{'html,body{background:#f4efe0}'}</style>
      </head>
      <body className="h-body">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Root() {
  return (
    <PocShell>
      <Outlet />
    </PocShell>
  );
}
