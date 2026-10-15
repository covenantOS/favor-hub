/// <reference types="vite/client" />
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useMatches } from '@tanstack/react-router';
import { resolveNav } from '@hub/data/areas';
import type { QueryClient } from '@tanstack/react-query';
import { WebShell } from '../shell/WebShell';
import { navQuery } from '../lib/queries';
import { useIdleReady } from '@/lib/idle';
import css from '../styles/layout.css?url';
// The classic layout inlines these three in its head, before anything draws: timer and listener ownership (hub-own), Lite mode's
// switch, timers, fonts and meter (lite), and held space with fade-through page changes (hub-motion). Web pages do the same.
import hubOwn from '../../../public/js/hub-own.js?raw';
import liteJs from '../../../public/js/lite.js?raw';
import motionJs from '../../../public/js/hub-motion.js?raw';

// The three scripts are sent in the page's head by the server. The browser already ran them by the time React hydrates and never reads
// their text again, so the browser build carries empty strings: the tree shaker then drops the three ?raw files (about 14 KB gzipped).
const INLINE_HEAD: readonly [string, string, string] = import.meta.env.SSR ? [hubOwn, liteJs, motionJs] : ['', '', ''];

// Before the first frame: the menu opens the way this person left it, the scrollbar width, and keyboard focus rings. Same as
// app/index.html and the classic layout.
// React reveals a streamed part (its inline $RC script) after one animation frame, unless $RT is already a number, and then after a timer.
// A page whose frames have stopped (a cross-document view transition that stalls, a tab opened in the background) never revealed its
// parts: each one stayed in the page twice, once hidden (div id="S:0"), with every id repeated. A number here makes the reveal run on a
// timer whatever the frames do. The first swap is not held back: a value this low is already past React's 300 ms spacing.
const BOOT = `window.$RT=-1e4;try{var np=JSON.parse(localStorage.getItem('favor.hub.nav.prefs.v1')||'{}');var nu=JSON.parse(localStorage.getItem('favor.hub.nav.v1')||'null');var pr=np[(nu&&nu.user&&nu.user.email)||'_']||np._||{};if(pr.wide&&matchMedia('(min-width: 1280px)').matches)document.documentElement.classList.add('nav-wide');}catch(e){}
// What Today holds space for, from what this browser remembers (the classic layout does the same in its body): the tour card while a tour is
// waiting, the cards the saved menu says this person has, and the height "Since you were away" had last time.
try{var de=document.documentElement,tp=localStorage.getItem('favor.hub.tours.pending');if(tp===null||Number(tp)>0||localStorage.getItem('favor.hub.td.welcome.v1')==='1')de.classList.add('show-welcome');var ac=(nu&&nu.access)||{};[['is-field','field'],['has-brain','brain'],['has-kpi','kpi'],['has-wc','workCenter'],['has-clips','clips'],['has-chat','chat'],['has-mail','mail'],['has-tasks','tasks'],['has-projects','projects']].forEach(function(p){if(ac[p[1]])de.classList.add(p[0])});if(ac.clips&&ac.clipsRecord!==false)de.classList.add('has-clip-rec');var ah=(JSON.parse(localStorage.getItem('favor.hub.td.away.v1')||'{}')||{})[Math.min(screen.width,innerWidth)<861?'p':'d'];if(ah>0){de.classList.add('td-away-held');de.style.setProperty('--td-away-h',ah+'px');}else if(ah===undefined){de.classList.add('td-await-away');}}catch(e){}
try{var d=document.createElement('div');d.style.cssText='position:absolute;top:-99px;width:50px;height:50px;overflow:scroll';document.documentElement.appendChild(d);document.documentElement.style.setProperty('--sbw',(d.offsetWidth-d.clientWidth)+'px');d.remove();}catch(e){}
// A page from an earlier build whose script files are gone reloads once instead of breaking (Vite fires vite:preloadError).
(function(){function again(){try{if(sessionStorage.getItem('favor.w.reload'))return false;sessionStorage.setItem('favor.w.reload','1');location.reload();return true;}catch(x){return false;}}
addEventListener('vite:preloadError',function(e){if(again())e.preventDefault();});
addEventListener('error',function(e){var t=e.target;var u=t&&(t.src||t.href)||'';if(u.indexOf('/_w/')>=0)again();},true);
addEventListener('unhandledrejection',function(e){var m=String((e.reason&&e.reason.message)||e.reason||'');if(/dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(m))again();});})();addEventListener('load',function(){setTimeout(function(){try{sessionStorage.removeItem('favor.w.reload')}catch(x){}},10000)});
(function(){var r=document.documentElement;addEventListener('keydown',function(e){if(e.key==='Tab'||e.key.indexOf('Arrow')===0)r.classList.add('kbd');},true);addEventListener('pointerdown',function(){r.classList.remove('kbd');},true);})();`;

// The web fonts are asked for early only outside Lite mode; in Lite the phone's own fonts are used and these never download (as on
// classic pages).
const FONTS = `if (!(window.FavorLite && window.FavorLite.on)) ['/fonts/inter-var.woff2', '/fonts/playfair-500.woff2'].forEach(function (h) { var l = document.createElement('link'); l.rel = 'preload'; l.href = h; l.as = 'font'; l.type = 'font/woff2'; l.crossOrigin = ''; document.head.appendChild(l); });`;

// Routes that draw without the frame (staticData.solo): the Clips recorder is a small window of its own, no rail, no top bar.
const isSoloPath = (p: string) => p === '/clips/rec' || p === '/clips/rec/';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ matches }) => ({
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
    // A solo route (the Clips recorder window) draws without the frame, so it loads none of the frame's stylesheet and brings its own.
    links: [
      ...(matches.some((m) => m.staticData?.solo) ? [] : [{ rel: 'stylesheet', href: css }]),
      { rel: 'icon', type: 'image/png', href: '/images/favor-icon.png' },
      { rel: 'apple-touch-icon', href: '/images/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  // The menu answer is asked for on the server before rendering starts and streams into the page when it arrives.
  loader: ({ context, location }) => {
    if (!isSoloPath(location.pathname)) void context.queryClient.prefetchQuery(navQuery);
  },
  shellComponent: Document,
  component: Root,
});

function Document({ children }: { children: ReactNode }) {
  // The page's area colors (body[data-area]) are on the server copy too, so the first paint is already in its accent.
  const navId = useMatches({ select: (m) => (m.at(-1)?.loaderData as { shell?: { nav: string } } | undefined)?.shell?.nav || m.map((x) => x.staticData?.nav).filter(Boolean).at(-1) }) || '';
  const area = navId ? resolveNav(navId)?.area.id : undefined;
  const solo = useMatches({ select: (m) => m.some((x) => x.staticData?.solo) });
  if (solo) {
    // The recorder window: its own head scripts and class, none of the frame's.
    return (
      <html lang="en" data-cr-standalone="1" suppressHydrationWarning>
        <head>
          <HeadContent />
          <style>{'html,body{margin:0;min-height:100%}'}</style>
        </head>
        <body className="cr-solo">
          {children}
          <Scripts />
        </body>
      </html>
    );
  }
  return (
    // The boot script sets classes and --sbw on <html> before React hydrates; those are expected to differ from the server copy.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <style>{'html,body{background:#f4efe0}'}</style>
        {__HUB_BUILD__ ? <meta name="hub-build" content={__HUB_BUILD__} /> : null}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: INLINE_HEAD[0] }} />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: INLINE_HEAD[1] }} />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: INLINE_HEAD[2] }} />
        <script dangerouslySetInnerHTML={{ __html: FONTS }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="h-body" data-nav={navId || undefined} data-area={area}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// The partner drawer and its tools are a large file; every page loads it after the page is idle, in its own chunk, so pages without
// partners never wait for it. Until it arrives a partner link does its own plain navigation.
const PartnerLinks = lazy(() => import('../features/partners/record/PartnerLinks').then((m) => ({ default: m.PartnerLinks })));
function IdlePartnerLinks() {
  const idle = useIdleReady();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && idle ? (
    <Suspense fallback={null}>
      <PartnerLinks />
    </Suspense>
  ) : null;
}

function Root() {
  const solo = useMatches({ select: (m) => m.some((x) => x.staticData?.solo) });
  if (solo) return <Outlet />;
  return (
    <WebShell>
      <Outlet />
      {/* Partner names open the partner drawer on every web page, as partner.js does on classic pages. A page that mounts its own copy keeps it. */}
      <IdlePartnerLinks />
    </WebShell>
  );
}
