// Loaded on every hub page by the App layout: sound and motion, the Feedback form, the meeting nudge, and the guided tour.
// The tour is an island (web/src/features/tour): its own script and stylesheet, built into dist/_tour and loaded after the
// first paint. The web app's frame mounts the same tour itself and says so with window.__favorTour, so this loads it only
// on the classic pages.
import { initFeel } from './feel';
import { initFeedback } from './feedback';
import { initNudge } from './nudge';

initFeel();
initFeedback();
initNudge();

function loadTourIsland() {
  const w = window as unknown as { __favorTour?: string; requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  const go = () => {
    if (w.__favorTour || document.querySelector('script[data-favor-tour]')) return;
    const b = document.querySelector<HTMLMetaElement>('meta[name="hub-build"]')?.content || '';
    const q = b ? `?b=${encodeURIComponent(b)}` : '';
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `/_tour/tour.css${q}`;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = `/_tour/tour.js${q}`;
    js.defer = true;
    js.setAttribute('data-favor-tour', '1');
    document.head.appendChild(js);
  };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 2500 });
  else setTimeout(go, 1200);
}
loadTourIsland();
