// The Work Center page: one component per tab. Each tab owns its file in this folder and its reads. Stylesheets in the order the
// classic page (src/pages/work/index.astro) imported them.
import { Suspense, useEffect } from 'react';
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
import { GiftsToThankView, prefetchGiftsToThank } from './GiftsToThank';
import { MyPartnersView, prefetchMyPartners } from './MyPartners';
import { AsksView, prefetchAsks } from './Asks';
import { CadenceView, prefetchCadence } from './Cadence';
import { MyWeekView, prefetchMyWeek } from './MyWeek';
import { EntryView, prefetchEntry } from './Entry';
import { GrantsView, prefetchGrants } from './Grants';
import { WorkHeader } from './WorkHeader';
import { contextQuery } from './lists/core';
import { asOf } from './actions/useWork';
import { hasTab } from './actions/tabs';
import type { Me } from './actions/types';

const LIST_TABS = ['gifts', 'mine', 'asks', 'cadence', 'week', 'intake', 'grants'];

export function prefetchWork(qc: QueryClient, s: WorkSearch): void {
  const v = s.view || 'open';
  // Who is asking decides whether a list tab is theirs (TabGate below).
  if (LIST_TABS.includes(v)) void qc.prefetchQuery(contextQuery(asOf(s)));
  if (v === 'gifts') prefetchGiftsToThank(qc, s);
  else if (v === 'mine') prefetchMyPartners(qc, s);
  else if (v === 'asks') prefetchAsks(qc, s);
  else if (v === 'cadence') prefetchCadence(qc, s);
  else if (v === 'week') prefetchMyWeek(qc, s);
  else if (v === 'intake') prefetchEntry(qc, s);
  else if (v === 'grants') prefetchGrants(qc, s);
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
            {view}
          </TabGate>
        </Suspense>
      ) : (
        <>
          {ownHeader ? null : <WorkHeader search={search} />}
          {view}
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
