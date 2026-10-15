// The frame every group B admin page shares: the page's own error boundary (a failed read replaces the whole page, as the classic pages do), the
// Admin head and tab row, and the loading box. Twin of the pieces in src/components/AdminHead.astro and public/js/admin.js (A.fail, A.denied).
import { Suspense, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import { Boundary } from '../partners/record/Boundary';
import { AdminHead } from '../admin-reports/AdminHead';

const statusOf = (e: Error) => ((e as Error & { status?: number }).status || 0);

/** The card a failed page shows: settings are for admins when the server said 401 or 403, otherwise the server's own words. */
export function Failed({ e }: { e: Error }) {
  const denied = statusOf(e) === 401 || statusOf(e) === 403;
  return (
    <div className="ad" id="ad-root">
      {denied ? (
        <div className="ad-card ad-denied">
          <p>Settings are for FavorOS admins.</p>
          <p>
            <a href="/">Back to Today</a>
          </p>
        </div>
      ) : (
        <div className="ad-card">
          <p className="ad-msg ad-msg--bad">{e.message && (e.name === 'HubReadError' || e.name === 'WriteError') ? e.message : 'That did not load.'}</p>
        </div>
      )}
    </div>
  );
}

/** A skeleton the size of the finished card, so the page does not move when the read answers. */
export function Wait({ h = 140 }: { h?: number }) {
  return (
    <div className="ad" aria-busy="true">
      <div className="ad-tile h-skel" style={{ minHeight: h }} />
    </div>
  );
}

export function AdminPage({ on, title, fact, intro, children, wait }: { on: string; title: string; fact?: string; intro?: ReactNode; children: ReactNode; wait?: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary fallback={(e) => <Failed e={e} />}>
          <div className="ad" id="ad-root">
            <AdminHead on={on} title={title} fact={fact} />
            {intro}
            <Suspense fallback={wait ?? <Wait />}>{children}</Suspense>
          </div>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}

/** Every answer to a write sets a short message under the control: "Saving", then "Saved" or the server's words. */
export interface Msg {
  ok: boolean;
  text: string;
}
export const msgClass = (m: Msg | null | undefined) => 'ad-msg' + (m && m.text ? (m.ok ? ' ad-msg--ok' : ' ad-msg--bad') : '');
