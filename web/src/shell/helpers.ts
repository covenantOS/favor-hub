// The classic layout's framework-free helpers (toasts with Undo, tooltips, sounds, haptics, the loading line, context menus, the ?
// sheet, ranges, typed dates, pull to refresh, the request panel, huddle rings, the partner card and its tools, and the rest),
// loaded on web pages after the first paint in the layout's own order. The list comes from the Pages build
// (/_app/layout-assets.json, written by scripts/app-layout-css.mjs), so a helper a teammate adds to the layout reaches web pages on
// the next build. The frame's own parts (menu, bell, dock, swap) are React here and are already left out of that list.
// hub-flow.js is left out too: it rewrites the digits inside counts React draws, and React would fight it.
import { layoutAssets, loadScript } from '@/lib/legacy';

const SKIP = /\/js\/(hub-flow)\.js/;

export async function mountClassicHelpers(): Promise<void> {
  const { js } = await layoutAssets();
  for (const src of js) {
    if (SKIP.test(src)) continue;
    await loadScript(src).catch((e) => console.warn('[helpers]', (e as Error).message));
  }
}
