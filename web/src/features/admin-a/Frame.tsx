// The frame every page of this group shares: the page's own error boundary (a failed read replaces the whole page, as the classic pages do through
// A.fail and A.denied in public/js/admin.js), the Admin head with its tab row, and a loading box the size of the finished card.
import { Suspense, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import { Boundary } from '../partners/record/Boundary';
import { AdminHead } from '../admin-reports/AdminHead';

export const statusOf = (e: Error) => (e as Error & { status?: number }).status || 0;

/** The card a failed page shows: settings are for admins on a 401 or 403, otherwise the server's own words. */
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

export function Wait({ h = 140 }: { h?: number }) {
  return (
    <div className="ad" aria-busy="true">
      <div className="ad-tile h-skel" style={{ minHeight: h }} />
    </div>
  );
}

export function Frame({ on, title, fact, root = 'ad-root', cls = 'ad', children, wait }: { on: string; title: string; fact?: string; root?: string; cls?: string; children: ReactNode; wait?: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary fallback={(e) => <Failed e={e} />}>
          <div className={cls} id={root}>
            <AdminHead on={on} title={title} fact={fact} />
            <Suspense fallback={wait ?? <Wait />}>{children}</Suspense>
          </div>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}

/** A message under a control: "Saving", then "Saved" or the server's words. */
export interface Msg {
  ok: boolean;
  text: string;
}
export const msgClass = (m: Msg | null | undefined) => 'ad-msg' + (m && m.text ? (m.ok ? ' ad-msg--ok' : ' ad-msg--bad') : '');
