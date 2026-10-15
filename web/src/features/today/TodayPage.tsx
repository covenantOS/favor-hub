// Today (/): what needs this person now, their schedule, how Favor is doing, then the cards for their job. Ported from the Astro page and
// public/js/today3.js, work-home.js and today-giftday.js on 2026-10-15. The markup and class names are the classic frame's
// (src/data/today-skeleton.ts), so the page looks the same and holds its space while each read answers.
import '@hub/styles/today2.css';
import '@hub/styles/work-home.css';
import '@hub/styles/qa2-workhome.css';
import '@hub/styles/today3.css';
import { Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { AfterHydration, TodayProvider } from './state';
import { Head, FirstWeek } from './Head';
import { NeedsCard, useNeedsRefresh } from './Needs';
import { ScheduleCard } from './Schedule';
import { DoingCard } from './Doing';
import { Modules } from './Modules';
import { RecentCard } from './Recent';

/**
 * The service worker (public/sw.js) keeps Today's last page for the signed-in person and opens the next visit from it. Lite mode and Chat
 * notices register the worker for some people; this registers it for anyone who opens the web Today, once the page is idle, so the visit after
 * this one is the fast one. Registering twice is harmless, and a person with no worker support (or a refusal) simply loads from the server.
 */
function useKeptToday() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .getRegistration('/')
        .then((r) => (r ? undefined : navigator.serviceWorker.register('/sw.js', { scope: '/' })))
        .catch(() => undefined);
    };
    const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const t = setTimeout(() => (idle ? idle(register, { timeout: 4000 }) : register()), 2000);
    return () => clearTimeout(t);
  }, []);
}

function Page() {
  const [doingHidden, setDoingHidden] = useState(false);
  useNeedsRefresh();
  useKeptToday();
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
          <AfterHydration fallback={<section className="td-mods wh tw" id="wh" aria-label="Your work" hidden />}>
            <Modules />
          </AfterHydration>
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
