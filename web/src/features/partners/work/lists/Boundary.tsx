// What a list tab shows while its read is on the way (a grey card the size of the rows) and when the read fails (the classic "did not load"
// card with Try again). The read itself is useSuspenseQuery inside the tab.
import { Component, Suspense, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';

/** A grey card shaped like the rows it stands for, so a tab never opens on a blank box (styles: crit-work2.css). */
export function Skel({ rows = 5 }: { rows?: number }) {
  return (
    <section className="h-card wc-sheet wc-skelrows" aria-busy="true" aria-label="Loading">
      <div className="wc-skelbar">
        <i />
        <i />
        <i />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div className="wc-skelrow" key={i}>
          <i className="a" />
          <i className="b" />
          <i className="c" />
        </div>
      ))}
    </section>
  );
}

interface EProps {
  what: string;
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
        <div className="pt-empty" role="alert">
          <b>{this.props.what} did not load</b>
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

export function ListBoundary({ what, rows = 5, children }: { what: string; rows?: number; children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Catch what={what} reset={reset}>
          <Suspense fallback={<Skel rows={rows} />}>{children}</Suspense>
        </Catch>
      )}
    </QueryErrorResetBoundary>
  );
}
