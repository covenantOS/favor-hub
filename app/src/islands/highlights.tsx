// A React island on the classic Reporting > Highlights page: public/js/reporting.js draws the week as text into #rg-hl-root
// (it still works if this file does not load), then announces the answer with "rg:week"; this replaces the text with the cards.
// Built by app/vite.config.ts as /_app/islands/hl-cards.js. When the page moves to the React app, the page imports HighlightCards.
import { createRoot, type Root } from 'react-dom/client';
import { HighlightCards, type Highlight } from '@/features/highlights/HighlightCards';

interface WeekAnswer {
  highlights?: { overall: Highlight; teams: Highlight[] };
}

declare global {
  interface Window {
    __rgWeek?: WeekAnswer;
  }
}

let root: Root | null = null;
let host: Element | null = null;

function draw(d: WeekAnswer | undefined) {
  const el = document.getElementById('rg-hl-root');
  const h = d && d.highlights;
  if (!el || !h || !h.overall) return;
  if (el !== host) {
    root?.unmount();
    el.textContent = '';
    root = createRoot(el);
    host = el;
  }
  root!.render(<HighlightCards overall={h.overall} teams={h.teams || []} />);
  el.setAttribute('data-cards', '1');
}

document.addEventListener('rg:week', (e) => draw((e as CustomEvent<WeekAnswer>).detail));
draw(window.__rgWeek);
