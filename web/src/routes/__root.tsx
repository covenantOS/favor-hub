/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { WebShell } from '../shell/WebShell';
import { navQuery } from '../lib/queries';
import css from '../styles/layout.css?url';

// Before the first frame: the menu opens the way this person left it, the scrollbar width, and keyboard focus rings. Same as
// app/index.html and the classic layout.
const BOOT = `try{var np=JSON.parse(localStorage.getItem('favor.hub.nav.prefs.v1')||'{}');var nu=JSON.parse(localStorage.getItem('favor.hub.nav.v1')||'null');var pr=np[(nu&&nu.user&&nu.user.email)||'_']||np._||{};if(pr.wide&&matchMedia('(min-width: 1280px)').matches)document.documentElement.classList.add('nav-wide');}catch(e){}
try{var d=document.createElement('div');d.style.cssText='position:absolute;top:-99px;width:50px;height:50px;overflow:scroll';document.documentElement.appendChild(d);document.documentElement.style.setProperty('--sbw',(d.offsetWidth-d.clientWidth)+'px');d.remove();}catch(e){}
(function(){var r=document.documentElement;addEventListener('keydown',function(e){if(e.key==='Tab'||e.key.indexOf('Arrow')===0)r.classList.add('kbd');},true);addEventListener('pointerdown',function(){r.classList.remove('kbd');},true);})();`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0, viewport-fit=cover' },
      { name: 'robots', content: 'noindex' },
      { name: 'theme-color', content: '#f4efe0' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'FavorOS' },
      { title: 'FavorOS' },
    ],
    links: [
      { rel: 'preload', href: '/fonts/inter-var.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'preload', href: '/fonts/playfair-500.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: css },
      { rel: 'icon', type: 'image/png', href: '/images/favor-icon.png' },
      { rel: 'apple-touch-icon', href: '/images/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  // The menu answer is asked for on the server before rendering starts and streams into the page when it arrives.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(navQuery);
  },
  shellComponent: Document,
  component: Root,
});

function Document({ children }: { children: ReactNode }) {
  return (
    // The boot script sets classes and --sbw on <html> before React hydrates; those are expected to differ from the server copy.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <style>{'html,body{background:#f4efe0}'}</style>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
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
    <WebShell>
      <Outlet />
    </WebShell>
  );
}
