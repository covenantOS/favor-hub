// Today (/): what needs this person now, their schedule, how Favor is doing, then the cards for their job. Ported from the Astro page and
// public/js/today3.js, work-home.js and today-giftday.js on 2026-10-15. The markup and class names are the classic frame's
// (src/data/today-skeleton.ts), so the page looks the same and holds its space while each read answers.
import '@hub/styles/today2.css';
import '@hub/styles/work-home.css';
import '@hub/styles/qa2-workhome.css';
import '@hub/styles/today3.css';
import { Suspense, useState } from 'react';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { TodayProvider } from './state';
import { Head, FirstWeek } from './Head';
import { NeedsCard, useNeedsRefresh } from './Needs';
import { ScheduleCard } from './Schedule';
import { DoingCard } from './Doing';
import { Modules } from './Modules';
import { RecentCard } from './Recent';

function Page() {
  const [doingHidden, setDoingHidden] = useState(false);
  useNeedsRefresh();
  return (
    <div className="td" id="td-root">
      <Head />
      <FirstWeek />
      <div className="td-main">
        <NeedsCard />
        <ScheduleCard />
        <DoingCard hidden={doingHidden} setHidden={setDoingHidden} />
      </div>
      <ErrorBoundary label="">
        <Suspense fallback={<section className="td-mods wh tw" id="wh" aria-label="Your work" hidden />}>
          <Modules />
        </Suspense>
      </ErrorBoundary>
      <RecentCard />
    </div>
  );
}

export function TodayPage() {
  return (
    <TodayProvider>
      <Page />
    </TodayProvider>
  );
}
