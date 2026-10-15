// Reports (/reports/): the list of reports this person may open, and one report at /reports/?r=<id> with its filters in the address. Port of
// src/pages/reports/index.astro and public/js/reports.js with the same markup, stylesheets and calls. Reads are drawn with useSuspenseQuery
// inside Suspense; the report's filters live in the address and in this page, as in the classic page.
import { Suspense, useState } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { useRouter, useRouterState } from '@tanstack/react-router';
import '@hub/styles/reports.css';
import '@hub/styles/qa-reporting.css';
import '@hub/styles/crit-reportadmin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
// Worst-case data fixes (scripts/break-ui).
import '@hub/styles/break-ui.css';
import { Boundary } from '../partners/record/Boundary';
import { askedOf, BASE, pageUrl } from './api';
import { List } from './List';
import { Report } from './One';
import { PageToast } from './toast';

const Loading = () => <p className="rp-note rp-loading">Loading</p>;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div id="rp-app" data-base={BASE} data-api="/api/reports">
      {children}
    </div>
  );
}

/** What a failed read says: the server's own sentence (it names the reason), or the page's own words. */
const said = (e: Error, fallback: string) => (e.name === 'HubReadError' && e.message && e.message !== 'Something went wrong. Try again.' ? e.message : e.name === 'HubReadError' ? fallback : 'FavorOS could not be reached. Check the connection and try again.');

function OneReport({ id, search }: { id: string; search: string }) {
  const router = useRouter();
  const url = askedOf(search);
  // The filters asked for. A change here asks the server again and the address follows; a new address (a link, Back) starts over from it.
  const sig = new URLSearchParams(search).toString();
  const [asked, setAsked] = useState<Record<string, string>>(url.asked);
  const [seen, setSeen] = useState(sig);
  if (seen !== sig) {
    setSeen(sig);
    setAsked(url.asked);
  }
  const ask = (values: Record<string, string>) => {
    const next = pageUrl(id, values);
    setSeen(new URLSearchParams(next.slice(next.indexOf('?'))).toString());
    setAsked(values);
    router.history.replace(next);
  };
  return <Report id={id} asked={asked} onAsk={ask} />;
}

function Body() {
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const { id } = askedOf(search);
  return id ? (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary
          key={id}
          fallback={(e) => (
            <Frame>
              <div className="h-card rp-box">
                <p className="rp-note">{said(e, 'That report did not load.')}</p>
                <p>
                  <a className="h-btn h-btn--ghost h-btn--sm" href={BASE}>
                    All reports
                  </a>
                </p>
              </div>
            </Frame>
          )}
        >
          <Suspense
            fallback={
              <Frame>
                <Loading />
              </Frame>
            }
          >
            <OneReport key={id} id={id} search={search} />
          </Suspense>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  ) : (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary
          fallback={(e) => (
            <Frame>
              <div className="h-card rp-box">
                <p className="rp-note">{said(e, 'Reports did not load.')}</p>
              </div>
            </Frame>
          )}
        >
          <Suspense
            fallback={
              <Frame>
                <Loading />
              </Frame>
            }
          >
            <Frame>
              <List />
            </Frame>
          </Suspense>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}

export function ReportsPage() {
  return (
    <>
      <Body />
      <PageToast />
    </>
  );
}
