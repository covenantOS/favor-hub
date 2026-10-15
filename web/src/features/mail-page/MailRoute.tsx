// Mail (/mail/) in the web app. The screen is app/src/features/mail (MailPage), the same one app2 draws; it talks to Gmail through
// /api/mail from the browser, so it is client-only. The server draws the frame and this skeleton at the screen's final size; the page
// loads after hydration and takes the skeleton's place without moving anything.
import { lazy, Suspense } from 'react';
import { ClientOnly } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import '@hub/styles/q3-chat.css';
import '@hub/styles/mail.css';

// The page's code starts downloading the moment this file runs (in the browser), not after hydration has drawn the skeleton.
const load = () => import('@/features/mail/MailPage').then((m) => ({ default: m.MailPage }));
const early = typeof window !== 'undefined' ? load() : null;
const MailPage = lazy(() => early ?? load());

const WIDTHS = [44, 63, 38, 55, 70, 41, 58, 47];

/** The mail screen's frame while the page loads: menu bar (phone), side, list with eight bones, empty reading pane. Same classes as MailPage. */
export function MailSkeleton() {
  return (
    <div className="ml" id="mail-root" data-view="list" aria-busy="true">
      <div className="ml-pnav">
        <span className="ml-pn" />
        <span className="ml-pn ml-pn--label">
          <span>Inbox</span>
        </span>
        <span className="ml-pn" />
      </div>
      <aside className="ml-side" aria-label="Mailboxes">
        <span className="ml-compose">
          <span>Compose</span>
        </span>
        <div className="ml-boxes" />
        <nav className="ml-labels" />
      </aside>
      <section className="ml-list" aria-label="Conversations">
        <div className="ml-search">
          <div className="ml-search__box">
            <span style={{ opacity: 0.5 }}>Search mail, or start with ? to ask</span>
          </div>
        </div>
        <div className="ml-list__head" />
        <div className="ml-rows">
          {WIDTHS.map((w, i) => (
            <div className="ml-row ml-row--skel" aria-hidden="true" key={i}>
              <span className="ml-av" />
              <span className="ml-row__t">
                <i style={{ width: w + '%' }} />
                <i style={{ width: '80%' }} />
                <i style={{ width: '60%' }} />
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="ml-read" aria-label="Conversation">
        <div className="ml-read__empty" />
      </section>
    </div>
  );
}

export function MailRoute() {
  return (
    <ErrorBoundary label="Mail could not load." className="h-card">
      <ClientOnly fallback={<MailSkeleton />}>
        <Suspense fallback={<MailSkeleton />}>
          <MailPage />
        </Suspense>
      </ClientOnly>
    </ErrorBoundary>
  );
}
