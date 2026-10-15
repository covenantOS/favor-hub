import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { pageMeta } from './meta';
import { useMatches, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { HubUser } from '@shared/schemas';
import { useApp2, useNav, pendingTours } from '@/data/hooks';
import { afterPaint, mountShellScripts } from '@/lib/legacy';
import { clearStored, keys } from '@/lib/query';
import { KEYS, readString, writeString } from '@/lib/storage';
import { Dock } from './Dock';
import { useIdleReady } from '@/lib/idle';
import { EntityHost } from '@/features/entity/EntityHost';
import { ErrorBoundary } from './ErrorBoundary';
import { NavLink, ServedRoutes } from './NavLink';
import { Palette } from './Palette';
import { PhoneBar } from './PhoneBar';
import { Rail } from './Rail';
import { TopBar } from './TopBar';
import { buildNav } from './model';
import { useRail } from './useRail';
import { MIGRATED_ROUTES } from '@shared/app2';

export interface RouteMeta {
  /** The nav id the classic layout takes as its `nav` prop ("home", "chat", "kpi-rdds"). */
  nav?: string;
  title?: string;
  /** Page width: the same four modes as the classic layout. */
  layout?: 'page' | 'wide' | 'full' | 'bare';
  description?: string;
}

const EMPTY_USER: HubUser = { email: '', name: '', picture: '', role: 'staff', via: 'password', kpi: false };

/** The persistent frame: rail, top bar, phone bar, search, dock and the helper scripts. It mounts once and never unloads between routes. */
export function Shell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const nav = useNav();
  const app2 = useApp2();
  const meta = useMatches({ select: (m) => m.map((x) => x.staticData as RouteMeta | undefined).filter(Boolean).at(-1) }) ?? {};
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pm = useSyncExternalStore(pageMeta.subscribe, pageMeta.get, pageMeta.get);
  const navId = meta.nav || pm.nav || '';
  const title = meta.title || pm.title || 'FavorOS';
  const d = nav.data;
  const user = d?.user ?? EMPTY_USER;
  const access = useMemo(() => (d?.access ?? { admin: false, kpi: false }) as Record<string, unknown> & { admin: boolean; kpi: boolean }, [d]);
  const kpiTeams = useMemo(() => d?.kpiTeams ?? [], [d]);
  const tours = pendingTours();
  const view = useMemo(
    () => buildNav({ access, kpiTeams, counts: d?.counts ?? {}, navId, tours }),
    [access, kpiTeams, d?.counts, navId, tours]
  );
  const idleReady = useIdleReady();
  const rail = useRail(user.email, view.curArea);

  // Routes the app serves for this person: a link to one stays inside the app.
  const served = useMemo(() => {
    const list = app2.data?.routes?.length ? app2.data.routes : [];
    const here = MIGRATED_ROUTES.find((r) => r === pathname) ? [pathname] : [];
    return Array.from(new Set([...here, ...list]));
  }, [app2.data, pathname]);

  // The same switches the classic pages put on <html> and <body> from the nav answer.
  useEffect(() => {
    const r = document.documentElement.classList;
    r.toggle('has-kpi', !!access.kpi);
    r.toggle('has-wc', !!access.workCenter);
    r.toggle('has-clips', !!access.clips);
    r.toggle('has-chat', !!access.chat);
    r.toggle('has-mail', !!access.mail);
    r.toggle('has-tasks', !!access.tasks);
    r.toggle('has-projects', !!access.projects);
    r.toggle('has-clip-rec', !!access.clips && access.clipsRecord !== false);
    const tp = readString(KEYS.tours, '');
    r.toggle('show-welcome', tp === '' || Number(tp) > 0);
  }, [access]);
  useEffect(() => {
    document.body.dataset.nav = navId;
    if (view.curArea) document.body.dataset.area = view.curArea;
    else delete document.body.dataset.area;
  }, [navId, view.curArea]);
  useEffect(() => {
    document.title = title + ' - FavorOS';
  }, [title]);

  // Leaving a page closes the phone menu and scrolls the new page to the top.
  useEffect(() => {
    rail.closeNav();
    document.getElementById('h-content')?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Helpers that predate the app, then the tour, Feedback form, sounds and meeting nudge, loaded after the first paint.
  useEffect(() => {
    (window as unknown as { hubNavRefresh: (force?: boolean) => void }).hubNavRefresh = (force) => {
      void qc.invalidateQueries({ queryKey: keys.nav, refetchType: force ? 'all' : 'active' });
    };
    afterPaint(() => {
      void mountShellScripts().then(() => import('@hub/scripts/hub'));
    });
  }, [qc]);

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

  const layout = meta.layout || (pm.nav ? pm.layout : undefined);
  const layoutClass = layout === 'bare' ? 'h-bare' : layout === 'wide' ? 'h-page h-page--wide' : layout === 'full' ? 'h-page h-page--full' : 'h-page';

  return (
    <ServedRoutes.Provider value={served}>
      <a className="h-skip" href="#h-content">
        Skip to the page
      </a>
      <div className={'h-app' + (rail.navOpen ? ' is-nav' : '') + (rail.peek ? ' is-peek' : '') + (rail.full ? ' is-open-full' : '')} id="h-app">
        <ErrorBoundary label="The menu could not load." className="h-side">
          <Rail view={view} user={user} rail={rail} tours={tours} onSignOut={signOut} />
        </ErrorBoundary>
        <div
          className="h-scrim"
          id="h-scrim"
          aria-hidden="true"
          onClick={() => {
            rail.setPeek(false);
            rail.closeNav();
          }}
        />
        <div className="h-main">
          <ErrorBoundary label="The top bar could not load." className="h-top">
            <TopBar actions={pm.actions} view={view} navId={navId} title={title} access={access} kpiTeams={kpiTeams} jobs={d?.jobs ?? null} user={user} onSignOut={signOut} menuOpen={rail.navOpen} onMenu={() => rail.setNavOpen(!rail.navOpen)} onRemember={rail.remember} />
          </ErrorBoundary>
          <main id="h-content" tabIndex={-1} className={layoutClass}>
            {children}
          </main>
        </div>
        <PhoneBar view={view} navOpen={rail.navOpen} onMore={() => rail.setNavOpen(!rail.navOpen)} />
      </div>
      <ErrorBoundary label="Search could not load." className="h-card">
        <Palette access={access} kpiTeams={kpiTeams} />
      </ErrorBoundary>
      <ErrorBoundary label="" className="h-card">
        <EntityHost />
      </ErrorBoundary>
      <Dock chat={!!access.chat && idleReady} page={navId} />
    </ServedRoutes.Provider>
  );
}

export { NavLink };
