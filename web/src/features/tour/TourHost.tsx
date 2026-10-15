// The tour inside the web app's frame. WebShell mounts this with one line. It draws nothing on the server and loads the tour after
// the first paint, so the frame streams as fast as before.
import { lazy, Suspense, useEffect, useState } from 'react';

declare global {
  interface Window {
    __favorTour?: string;
  }
}

// Claim the page before the classic script can: hub.ts loads the island only when nobody has.
if (typeof window !== 'undefined' && !window.__favorTour) window.__favorTour = 'web';

const Tour = lazy(() => import('./TourRoot').then((m) => ({ default: m.TourRoot })));

export function TourHost() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // The classic pages' island checks this before it mounts.
    if (window.__favorTour && window.__favorTour !== 'web') return;
    window.__favorTour = 'web';
    const run = () => setOn(true);
    const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2500 });
    else window.setTimeout(run, 1200);
  }, []);
  return on ? (
    <Suspense fallback={null}>
      <Tour />
    </Suspense>
  ) : null;
}
