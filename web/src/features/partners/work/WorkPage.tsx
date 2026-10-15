// The Work Center page: one component per tab. Each tab owns its file in this folder and its reads. Stylesheets in the order the
// classic page (src/pages/work/index.astro) imported them.
import { lazy, Suspense, useEffect } from 'react';
import { useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import '@hub/styles/work.css';
import '@hub/styles/work-edit.css';
import '@hub/styles/wc-mine.css';
import '@hub/styles/work-start.css';
import '@hub/styles/work-addpartner.css';
import '@hub/styles/work-asks.css';
import '@hub/styles/work-letters.css';
import '@hub/styles/work-cadence.css';
import '@hub/styles/work-functions.css';
import '@hub/styles/work-week.css';
import '@hub/styles/qa-work.css';
import '@hub/styles/fix-work.css';
import '@hub/styles/qa2-wcasks.css';
import '@hub/styles/crit-work.css';
import '@hub/styles/crit-work2.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/wc-fix.css';
import '@hub/styles/break-ui.css';
import '@hub/styles/partners.css';
import '@hub/styles/ptable.css';
import '@hub/styles/pt-actions.css';
import '@hub/styles/pt-asks.css';
import '@hub/styles/pt-lists.css';
import type { WorkSearch } from './search';
import { ActionsView, prefetchActions } from './Actions';
// The other tabs load as their own files; their stylesheets stay with the page, in the order the tabs used to bring them, so the server
// links them in the page's head and nothing draws unstyled before a tab's file arrives.
import '@hub/styles/pt-react-lists.css';
import './actions/entry/entry.css';
import { WorkHeader } from './WorkHeader';
import { contextQuery } from './lists/core';
import { asOf } from './actions/useWork';
import { hasTab } from './actions/tabs';
import type { Me } from './actions/types';

// Actions is the page people land on, so it ships with the page. Each other tab is its own file, fetched when that tab opens (together they
// were 60 KB gzipped on every visit to Actions).
const GiftsToThankView = lazy(() => import('./GiftsToThank').then((m) => ({ default: m.GiftsToThankView })));
const MyPartnersView = lazy(() => import('./MyPartners').then((m) => ({ default: m.MyPartnersView })));
const AsksView = lazy(() => import('./Asks').then((m) => ({ default: m.AsksView })));
const CadenceView = lazy(() => import('./Cadence').then((m) => ({ default: m.CadenceView })));
const MyWeekView = lazy(() => import('./MyWeek').then((m) => ({ default: m.MyWeekView })));
const EntryView = lazy(() => import('./Entry').then((m) => ({ default: m.EntryView })));
const GrantsView = lazy(() => import('./Grants').then((m) => ({ default: m.GrantsView })));

const LIST_TABS = ['gifts', 'mine', 'asks', 'cadence', 'week', 'intake', 'grants'];

export function prefetchWork(qc: QueryClient, s: WorkSearch): void {
  const v = s.view || 'open';
  // Who is asking decides whether a list tab is theirs (TabGate below).
  if (LIST_TABS.includes(v)) void qc.prefetchQuery(contextQuery(asOf(s)));
  // A tab's reads start as its file arrives (the same file the page is about to draw it from).
  if (v === 'gifts') void import('./GiftsToThank').then((m) => m.prefetchGiftsToThank(qc, s));
  else if (v === 'mine') void import('./MyPartners').then((m) => m.prefetchMyPartners(qc, s));
  else if (v === 'asks') void import('./Asks').then((m) => m.prefetchAsks(qc, s));
  else if (v === 'cadence') void import('./Cadence').then((m) => m.prefetchCadence(qc, s));
  else if (v === 'week') void import('./MyWeek').then((m) => m.prefetchMyWeek(qc, s));
  else if (v === 'intake') void import('./Entry').then((m) => m.prefetchEntry(qc, s));
  else if (v === 'grants') void import('./Grants').then((m) => m.prefetchGrants(qc, s));
  else prefetchActions(qc, s);
}

export function WorkPage({ search }: { search: WorkSearch }) {
  const v = search.view || 'open';
  const view =
    v === 'gifts' ? <GiftsToThankView search={search} />
    : v === 'mine' ? <MyPartnersView search={search} />
    : v === 'asks' ? <AsksView search={search} />
    : v === 'cadence' ? <CadenceView search={search} />
    : v === 'week' ? <MyWeekView search={search} />
    : v === 'intake' ? <EntryView search={search} />
    : v === 'grants' ? <GrantsView search={search} />
    : <ActionsView search={search} />;
  // Actions and Entry draw the header themselves; every other tab gets the same pills row the classic Work Center shows on all tabs.
  const ownHeader = v === 'intake' || !['gifts', 'mine', 'asks', 'cadence', 'week', 'grants'].includes(v);
  return (
    <div className="wc-root" id="wc-root">
      {LIST_TABS.includes(v) ? (
        <Suspense fallback={null}>
          <TabGate search={search} v={v}>
            {ownHeader ? null : <WorkHeader search={search} />}
            <Suspense fallback={null}>{view}</Suspense>
          </TabGate>
        </Suspense>
      ) : (
        <>
          {ownHeader ? null : <WorkHeader search={search} />}
          <Suspense fallback={null}>{view}</Suspense>
        </>
      )}
    </div>
  );
}

/** A list tab this person does not have opens Actions instead, at /work/, as the classic page does (work.js switches only to a tab
 *  WCTabs.has allows). */
function TabGate({ search, v, children }: { search: WorkSearch; v: string; children: React.ReactNode }) {
  const me = useSuspenseQuery(contextQuery(asOf(search))).data.me as Me;
  const ok = hasTab(v, me);
  const nav = useNavigate();
  useEffect(() => {
    if (!ok) void nav({ to: '/work/', search: { ...search, view: undefined }, replace: true });
  }, [ok, nav, search]);
  return ok ? <>{children}</> : <ActionsView search={{ ...search, view: undefined }} />;
}
