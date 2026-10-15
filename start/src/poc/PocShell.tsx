// The persistent frame for the POC: the app2 Rail, TopBar, PhoneBar and Ctrl K palette, drawn on the server from the nav answer.
// The frame streams first; the rail and top bar stream in as their own HTML the moment /api/hub/nav answers (Suspense), so the
// browser fetches the CSS and scripts while the server is still reading. The page body is a sibling and never waits on the menu.
// Left out on purpose (the full move brings them): the dock, entity hover cards and the classic helper scripts.
import { Suspense, useMemo, type ReactNode } from 'react';
import { useMatches } from '@tanstack/react-router';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { HubUser } from '@shared/schemas';
import { buildNav } from '@/shell/model';
import { Rail } from '@/shell/Rail';
import { TopBar } from '@/shell/TopBar';
import { PhoneBar } from '@/shell/PhoneBar';
import { Palette } from '@/shell/Palette';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { ServedRoutes } from '@/shell/NavLink';
import { useRail } from '@/shell/useRail';
import { navQuery } from './queries';

const EMPTY_USER: HubUser = { email: '', name: '', picture: '', role: 'staff', via: 'password', kpi: false };
const SERVED = ['/projects/'];
type Rail = ReturnType<typeof useRail>;

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

function RailPart({ rail }: { rail: Rail }) {
  const { d, view } = useView();
  return <Rail view={view} user={d.user ?? EMPTY_USER} rail={rail} tours={0} onSignOut={() => undefined} />;
}

function TopPart({ rail }: { rail: Rail }) {
  const { access, kpiTeams, view, navId } = useView();
  const { title } = useMeta();
  return <TopBar view={view} navId={navId} title={title} access={access} kpiTeams={kpiTeams} menuOpen={rail.navOpen} onMenu={() => rail.setNavOpen(!rail.navOpen)} onRemember={rail.remember} />;
}

function BarPart({ rail }: { rail: Rail }) {
  const { view } = useView();
  return <PhoneBar view={view} navOpen={rail.navOpen} onMore={() => rail.setNavOpen(!rail.navOpen)} />;
}

function PalettePart() {
  const { access, kpiTeams } = useView();
  return <Palette access={access} kpiTeams={kpiTeams} />;
}

export function PocShell({ children }: { children: ReactNode }) {
  const nav = useQuery(navQuery);
  const { title, layout } = useMeta();
  const rail = useRail(nav.data?.user?.email ?? '', '');
  const layoutClass = layout === 'bare' ? 'h-bare' : layout === 'wide' ? 'h-page h-page--wide' : layout === 'full' ? 'h-page h-page--full' : 'h-page';
  return (
    <ServedRoutes.Provider value={SERVED}>
      <a className="h-skip" href="#h-content">
        Skip to the page
      </a>
      <div className={'h-app' + (rail.navOpen ? ' is-nav' : '') + (rail.peek ? ' is-peek' : '') + (rail.full ? ' is-open-full' : '')} id="h-app">
        <ErrorBoundary label="The menu could not load." className="h-side">
          <Suspense fallback={<aside className="h-side" aria-hidden="true" />}>
            <RailPart rail={rail} />
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
    </ServedRoutes.Provider>
  );
}
