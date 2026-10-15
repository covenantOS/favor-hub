// Shared by the two Work Center desks that now live under Gifts (Thank-you letters and Declines): the stylesheets the classic pages loaded, the
// frame that holds a desk (#wc-root, #view), the skeleton and the "did not load" card, and a few small helpers.
import { Component, Suspense, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Skel } from '../../partners/work/lists/Boundary';
import { WorkToast } from '../../partners/work/lists/toast';
import '@hub/styles/work.css';
import '@hub/styles/work-edit.css';
import '@hub/styles/work-letters.css';
import '@hub/styles/qa-work.css';
import '@hub/styles/fix-work.css';
import '@hub/styles/crit-work.css';
import '@hub/styles/crit-work2.css';
import '@hub/styles/wc-fix.css';
import '@hub/styles/break-ui.css';
import '@hub/styles/gifts-pages.css';

/** The comma form the lists use for counts: 1,234. */
export const n0 = (v: number | string | null | undefined): string => (Number(v) || 0).toLocaleString('en-US');

/** A read of the desk, as the page asks for it. A search address carries ?as= (an admin looking at a teammate's view). */
export interface DeskSearch {
  as?: string;
}
export const deskSearch = (s: Record<string, unknown>): DeskSearch => (typeof s.as === 'string' && s.as ? { as: s.as } : {});

interface EProps {
  reset: () => void;
  children: ReactNode;
}
class Catch extends Component<EProps, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <section className="h-card wc-sheet">
        <div className="wg-empty" role="alert">
          <b>The list did not load</b>
          {e.message}
          <p>
            <button
              type="button"
              className="h-btn h-btn--primary"
              onClick={() => {
                this.props.reset();
                this.setState({ error: null });
              }}
            >
              Try again
            </button>
          </p>
        </div>
      </section>
    );
  }
}

/** The classic frame of a desk: .wc-root around #view, the skeleton while the read is on the way, the card when it fails. */
export function DeskFrame({ tab, children }: { tab: string; children: ReactNode }) {
  return (
    <>
      <div className="wc-root gp-root" id="wc-root" aria-live="polite">
        <div id="view" data-wc-tab={tab}>
          <QueryErrorResetBoundary>
            {({ reset }) => (
              <Catch reset={reset}>
                <Suspense fallback={<Skel rows={5} />}>{children}</Suspense>
              </Catch>
            )}
          </QueryErrorResetBoundary>
        </div>
      </div>
      <WorkToast />
    </>
  );
}
