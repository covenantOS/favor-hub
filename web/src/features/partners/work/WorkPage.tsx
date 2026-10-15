// The Work Center page: one component per tab. Each tab owns its file in this folder and its reads. Stylesheets in the order the
// classic page (src/pages/work/index.astro) imported them.
import type { QueryClient } from '@tanstack/react-query';
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

export function prefetchWork(qc: QueryClient, s: WorkSearch): void {
  const v = s.view || 'open';
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
  return (
    <div className="wc-root" id="wc-root">
      {view}
    </div>
  );
}
