// Reporting > Highlights (/highlights/): where each goal ends the year, the week in plain language for each team, and My dashboard (the answers
// a person pinned from Favor Brain). Port of src/pages/highlights/index.astro and public/js/reporting.js with the same markup and stylesheets.
// The week is read with useSuspenseQuery inside Suspense; the pins draw in the browser (their "Asked" line depends on the clock).
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { QueryErrorResetBoundary, useQuery } from '@tanstack/react-query';
import '@hub/styles/reporting.css';
import '@hub/styles/brain.css';
import './highlights.css';
import { Boundary } from '../partners/record/Boundary';
import { pinsQuery } from './api';
import { loadDrill } from './drill';
import { failText } from './format';
import { PageToast } from './toast';
import { Week, WeekWait } from './Week';

// The pins and the Brain blocks they draw load only when My dashboard opens.
const Pins = lazy(() => import('./Pins').then((m) => ({ default: m.Pins })));

export type Tab = 'week' | 'mine';

function PinsWait() {
  return (
    <div className="rg-wait" role="status">
      <span className="h-spin" aria-hidden="true" />
      Opening your pins
    </div>
  );
}

function PinCount() {
  const { data } = useQuery(pinsQuery);
  // The count depends on a read that may land between the server's page and the browser's first draw, so it is drawn after mount.
  const mounted = useMounted();
  const n = mounted && data?.ok !== false ? (data?.pins || []).length : 0;
  return (
    <span className="rg-count" id="rg-pin-count" hidden={!n}>
      {n ? String(n) : ''}
    </span>
  );
}

function Alert({ text }: { text: string }) {
  return (
    <div className="h-card rg-empty" role="alert">
      <p>{text}</p>
    </div>
  );
}

function useMounted() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  return on;
}

export function HighlightsPage({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  // A tab opened once stays drawn, as on the classic page (its numbers are not read again when the person comes back).
  const [seen, setSeen] = useState<Record<Tab, boolean>>({ week: tab === 'week', mine: tab === 'mine' });
  useEffect(() => setSeen((s) => (s[tab] ? s : { ...s, [tab]: true })), [tab]);
  const mounted = useMounted();
  useEffect(() => loadDrill(), []);
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ week: null, mine: null });
  const order: Tab[] = ['week', 'mine'];
  const show = (t: Tab) => {
    onTab(t);
  };
  const key = (e: React.KeyboardEvent, t: Tab) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = order[(order.indexOf(t) + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
    show(next);
    tabs.current[next]?.focus();
  };
  return (
    <>
      <div className="rg h-page">
        <div className="rg-head">
          <div className="rg-tabs" role="tablist" aria-label="Reporting views">
            <button
              type="button"
              role="tab"
              className={'rg-tab' + (tab === 'week' ? ' is-on' : '')}
              id="rg-tab-week"
              aria-selected={tab === 'week'}
              aria-controls="rg-week"
              data-tab="week"
              tabIndex={tab === 'week' ? 0 : -1}
              ref={(el) => {
                tabs.current.week = el;
              }}
              onClick={() => show('week')}
              onKeyDown={(e) => key(e, 'week')}
            >
              This week
            </button>
            <button
              type="button"
              role="tab"
              className={'rg-tab' + (tab === 'mine' ? ' is-on' : '')}
              id="rg-tab-mine"
              aria-selected={tab === 'mine'}
              aria-controls="rg-mine"
              data-tab="mine"
              tabIndex={tab === 'mine' ? 0 : -1}
              ref={(el) => {
                tabs.current.mine = el;
              }}
              onClick={() => show('mine')}
              onKeyDown={(e) => key(e, 'mine')}
            >
              My dashboard <PinCount />
            </button>
          </div>
        </div>
        <section id="rg-week" role="tabpanel" aria-labelledby="rg-tab-week" hidden={tab !== 'week'}>
          {seen.week ? (
            <QueryErrorResetBoundary>
              {() => (
                <Boundary fallback={(e) => <Alert text={failText(e, 'The numbers did not load. Reload in a minute.')} />}>
                  <Suspense fallback={<WeekWait />}>
                    <Week />
                  </Suspense>
                </Boundary>
              )}
            </QueryErrorResetBoundary>
          ) : null}
        </section>
        <section id="rg-mine" role="tabpanel" aria-labelledby="rg-tab-mine" hidden={tab !== 'mine'}>
          {seen.mine ? (
            mounted ? (
              <QueryErrorResetBoundary>
                {() => (
                  <Boundary fallback={(e) => <Alert text={failText(e, 'Your pins did not load. Reload in a minute.')} />}>
                    <Suspense fallback={<PinsWait />}>
                      <Pins />
                    </Suspense>
                  </Boundary>
                )}
              </QueryErrorResetBoundary>
            ) : (
              <PinsWait />
            )
          ) : null}
        </section>
      </div>
      <PageToast />
    </>
  );
}
