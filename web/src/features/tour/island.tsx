// The tour on the classic Astro pages: one script and one stylesheet, built by web/vite.tour.config.ts into dist/_tour and
// loaded after the first paint by src/scripts/hub.ts. It mounts the same component the web app mounts. If the web app's frame
// already mounted the tour on this page, this script does nothing.
import { createRoot } from 'react-dom/client';
import { TourRoot } from './TourRoot';

declare global {
  interface Window {
    __favorTour?: string;
  }
}

if (!window.__favorTour) {
  window.__favorTour = 'island';
  const host = document.createElement('div');
  host.id = 'favor-tour-island';
  document.body.appendChild(host);
  createRoot(host).render(<TourRoot />);
}
