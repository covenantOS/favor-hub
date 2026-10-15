// The FavorOS frame for pages served by the web app: the app2 rail, top bar, phone bar, Ctrl K, entity cards and dock, drawn on the
// server. The frame streams first; the rail and top bar stream in as their own HTML the moment /api/hub/nav answers, so the browser
// fetches styles and scripts while the server is still reading. The page body is a sibling and never waits on the menu.
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMatches, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { HubUser } from '@shared/schemas';
import { buildNav } from '@/shell/model';
import { Rail } from '@/shell/Rail';
import { TopBar } from '@/shell/TopBar';
import { PhoneBar } from '@/shell/PhoneBar';
import { Palette } from '@/shell/Palette';
import { Dock } from '@/shell/Dock';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { ServedRoutes } from '@/shell/NavLink';
import { useRail } from '@/shell/useRail';
import { EntityHost } from '@/features/entity/EntityHost';
import { useNav } from '@/data/hooks';
import { useIdleReady } from '@/lib/idle';
import { installHubOv } from '@/lib/hubOv';
import { afterPaint, mountShellScripts } from '@/lib/legacy';
import { clearStored, keys } from '@/lib/query';
import { KEYS, writeString } from '@/lib/storage';
import { WEB_ROUTES } from '@shared/web';
import { navQuery } from '../lib/queries';
import { mountClassicHelpers } from './helpers';

const EMPTY_USER: HubUser = { email: '', name: '', picture: '', role: 'staff', via: 'password', kpi: false };
type RailState = ReturnType<typeof useRail>;

function useMeta() {
  const meta = useMatches({ select: (m) => m.map((x) => x.staticData).filter(Boolean).at(-1) }) ?? {};
  return { navId: meta.nav || '', title: meta.title || 'FavorOS', layout: meta.layout };
}

function useView() {
  const { data: d } = useSuspenseQuery(navQuery);
  const { navId } = useMeta();
  const access = useMemo(() => (d.access ?? { admin: false, kpi: false }) as Record<string, unknown> & { admin: boolean; kpi: boolean }, [d]);
  const kpiTeams = useMemo(() => d.kpiTeams ?? [], [d]);
  const view = useMemo(() => buildNav({ access, kpiTeams, counts: d.counts ?? {}, navId, tours: 0 }), [access, kpiTeams, d.counts, navId]);
  return { d, access, kpiTeams, view, navId };
}

function RailPart({ rail, onSignOut }: { rail: RailState; onSignOut: () => void }) {
  const { d, view } = useView();
  return <Rail view={view} user={d.user ?? EMPTY_USER} rail={rail} tours={0} onSignOut={onSignOut} />;
}

function TopPart({ rail }: { rail: RailState }) {
  const { d, access, kpiTeams, view, navId } = useView();
  const { title } = useMeta();
  return <TopBar view={view} navId={navId} title={title} access={access} kpiTeams={kpiTeams} jobs={d.jobs ?? null} menuOpen={rail.navOpen} onMenu={() => rail.setNavOpen(!rail.navOpen)} onRemember={rail.remember} />;
}

function BarPart({ rail }: { rail: RailState }) {
  const { view } = useView();
  return <PhoneBar view={view} navOpen={rail.navOpen} onMore={() => rail.setNavOpen(!rail.navOpen)} />;
}

function PalettePart() {
  const { access, kpiTeams } = useView();
  return <Palette access={access} kpiTeams={kpiTeams} />;
}

/** Work the browser does once: the back-gesture stack, the menu's side effects (window.FAVOR_HUB, the saved copy), helper scripts. */
function ClientBoot() {
  const qc = useQueryClient();
  useNav();
  useEffect(() => {
    installHubOv();
    (window as unknown as { hubNavRefresh: (force?: boolean) => void }).hubNavRefresh = (force) => {
      void qc.invalidateQueries({ queryKey: keys.nav, refetchType: force ? 'all' : 'active' });
    };
    afterPaint(() => {
      void mountShellScripts()
        .then(() => import('@hub/scripts/hub'))
        .then(() => mountClassicHelpers());
    });
    // A home screen app keeps its page in memory: when it comes back to the front and a newer hub is live, reload once (app-update.js).
    const mine = document.querySelector('meta[name="hub-build"]')?.getAttribute('content');
    let last = 0;
    const check = () => {
      if (!mine || Date.now() - last < 30000) return;
      last = Date.now();
      const a = document.activeElement as HTMLInputElement | null;
      if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.value) return;
      fetch('/version.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { build?: string } | null) => {
          if (j && j.build && j.build !== mine) location.reload();
        })
        .catch(() => undefined);
    };
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', check);
    };
  }, [qc]);
  return null;
}

function DockPart() {
  const { access, navId } = useView();
  const idle = useIdleReady();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <Dock chat={!!access.chat && idle} page={navId} /> : null;
}

export function WebShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const nav = useQuery(navQuery);
  const { navId, title, layout } = useMeta();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const access = nav.data?.access as Record<string, unknown> | undefined;
  const rail = useRail(nav.data?.user?.email ?? '', '');

  // The same switches the classic pages put on <html> and <body> from the nav answer.
  useEffect(() => {
    if (!access) return;
    const r = document.documentElement.classList;
    r.toggle('has-kpi', !!access.kpi);
    r.toggle('has-wc', !!access.workCenter);
    r.toggle('has-clips', !!access.clips);
    r.toggle('has-chat', !!access.chat);
    r.toggle('has-tasks', !!access.tasks);
    r.toggle('has-projects', !!access.projects);
    r.toggle('has-clip-rec', !!access.clips && access.clipsRecord !== false);
  }, [access]);
  useEffect(() => {
    document.body.dataset.nav = navId;
    document.title = title + ' - FavorOS';
  }, [navId, title]);
  useEffect(() => {
    rail.closeNav();
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const signOut = useCallback(async () => {
    writeString(KEYS.nav, null);
    clearStored(qc);
    try {
      sessionStorage.clear();
    } catch {
      // nothing saved to clear
    }
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    location.href = '/login/?signedout=1';
  }, [qc]);

  const layoutClass = layout === 'bare' ? 'h-bare' : layout === 'wide' ? 'h-page h-page--wide' : layout === 'full' ? 'h-page h-page--full' : 'h-page';
  return (
    <ServedRoutes.Provider value={[...WEB_ROUTES]}>
      <a className="h-skip" href="#h-content">
        Skip to the page
      </a>
      <div className={'h-app' + (rail.navOpen ? ' is-nav' : '') + (rail.peek ? ' is-peek' : '') + (rail.full ? ' is-open-full' : '')} id="h-app">
        <ErrorBoundary label="The menu could not load." className="h-side">
          <Suspense fallback={<aside className="h-side" id="h-side" aria-hidden="true" />}>
            <RailPart rail={rail} onSignOut={signOut} />
          </Suspense>
        </ErrorBoundary>
        <div className="h-scrim" id="h-scrim" aria-hidden="true" onClick={() => { rail.setPeek(false); rail.closeNav(); }} />
        <div className="h-main">
          <ErrorBoundary label="The top bar could not load." className="h-top">
            <Suspense
              fallback={
                <header className="h-top">
                  <div className="h-top__head">
                    <div className="h-top__title">{title}</div>
                  </div>
                </header>
              }
            >
              <TopPart rail={rail} />
            </Suspense>
          </ErrorBoundary>
          <main id="h-content" tabIndex={-1} className={layoutClass}>
            {children}
          </main>
        </div>
        <Suspense fallback={null}>
          <BarPart rail={rail} />
        </Suspense>
      </div>
      <ErrorBoundary label="Search could not load." className="h-card">
        <Suspense fallback={null}>
          <PalettePart />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="" className="h-card">
        <EntityHost />
      </ErrorBoundary>
      <Suspense fallback={null}>
        <DockPart />
      </Suspense>
      <ClientBoot />
    </ServedRoutes.Provider>
  );
}
