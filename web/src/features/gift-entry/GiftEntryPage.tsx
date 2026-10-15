// Gift entry (/gift-entry/): the front page, or the deposit named by ?d=. ?start=1 puts the cursor in the tape total. The page keeps the
// classic markup (#ge-root, #ge-layer, the .ge-* classes) and its stylesheet, and the same /api/gift-entry routes.
import '@hub/styles/gift-entry.css';
import { Component, Suspense, useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Deposit } from './Deposit';
import { Home, type HomeForm } from './Home';
import { geKeys } from './data';
import { GeToast, geToast } from './toast';

/** The classic page's failure card: the words the server gave, in the page's own card. */
class GeBoundary extends Component<{ children: ReactNode; onError?: (e: Error) => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.onError) return null;
    return (
      <section className="h-card ge-card">
        <div className="ge-empty">{this.state.error.message || 'Something went wrong. Try again.'}</div>
      </section>
    );
  }
}

const Skeleton = () => <div className="h-skel" style={{ height: 320, borderRadius: 18 }}></div>;

export function GiftEntryPage({ d, start }: { d?: string; start: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<HomeForm>({ kind: 'regular' });
  const [depFilter, setDepFilter] = useState('all');
  const [sumDate, setSumDate] = useState('');

  // Back to the front page: the address drops ?d= and the lists are read again.
  const goHome = useCallback(() => {
    for (const k of [geKeys.index, ['ge', 'summary'], geKeys.month, geKeys.needs, geKeys.overview]) void qc.invalidateQueries({ queryKey: k });
    void navigate({ to: '/gift-entry/', search: {}, replace: true });
  }, [navigate, qc]);

  return (
    <>
      <div className="ge-root" id="ge-root" aria-live="polite">
        <GeBoundary>
          <Suspense fallback={<Skeleton />}>
            {d ? (
              <GeBoundary
                key={d}
                onError={(e) => {
                  geToast(e.message);
                  goHome();
                }}
              >
                <Deposit id={d} goHome={goHome} />
              </GeBoundary>
            ) : (
              <Home start={start} form={form} setForm={setForm} depFilter={depFilter} setDepFilter={setDepFilter} sumDate={sumDate} setSumDate={setSumDate} />
            )}
          </Suspense>
        </GeBoundary>
      </div>
      <div id="ge-layer"></div>
      <GeToast />
    </>
  );
}
