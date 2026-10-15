// The click-to-explain panel (public/js/drill.js) opens from any element marked data-drill and from FavorDrill.open. The classic layout writes the
// script into the page itself; the web shell does not carry it yet, so a page that uses it loads it here, once, when the page is idle.
// Skipped when something already loaded it (the shell later, or another page of this visit).
import { loadScript } from '@/lib/legacy';

const SRC = '/js/drill.js?v=9';

export function loadDrill(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as { FavorDrill?: unknown };
  if (w.FavorDrill || document.querySelector('script[src*="/js/drill.js"]')) return;
  loadScript(SRC).catch(() => undefined);
}
