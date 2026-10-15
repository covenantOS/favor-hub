// Writes dist/_app/layout-assets.json: the stylesheets and scripts nearly every classic page carries because of the shared layout.
//  css  the React app bundles the frame's styles itself, so a classic page brought into the frame skips these.
//  js   scripts page code expects to find (partner drawer, records, thank-you, prep, ...), in the layout's order. The frame's own behavior
//       (menu, bell, dock, swap, clips launcher) is native in the app and left out.
// Built from the pages themselves, so a script a teammate adds to the layout reaches the app's classic pages on the next build.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const pages = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (n === '_app' || n === '_astro') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.html')) pages.push(readFileSync(p, 'utf8'));
  }
})(dist);
const hub = pages.filter((h) => h.includes('id="h-content"'));
const NATIVE = /\/js\/(hub-shell|hub-nav|hub-swap|wc-bell|dock|app-update|clips-launch)\.js/;
const css = new Map();
const js = new Map();
let order = 0;
for (const h of hub) {
  for (const m of new Set(h.match(/<link[^>]+rel="stylesheet"[^>]*>/g) || [])) {
    const href = /href="([^"]+)"/.exec(m)?.[1];
    if (href && href.startsWith('/_astro/')) css.set(href, (css.get(href) || 0) + 1);
  }
  for (const m of h.match(/<script[^>]+src="[^"]+"[^>]*>/g) || []) {
    const src = /src="([^"]+)"/.exec(m)?.[1];
    // A tag a script writes (App.astro's document.write of "/js/' + f + '") is not a file; its quotes and plus signs give it away.
    if (!src || !src.startsWith('/js/') || NATIVE.test(src) || /['+\s]/.test(src)) continue;
    const clean = src.replace(/[?&]b=\d+/, '');
    if (!js.has(clean)) js.set(clean, { n: 0, at: order++ });
    js.get(clean).n++;
  }
}
const need = hub.length * 0.8;
const out = {
  css: [...css].filter(([, n]) => n >= need).map(([h]) => h),
  js: [...js].filter(([, v]) => v.n >= need).sort((a, b) => a[1].at - b[1].at).map(([s]) => s),
};
// The Projects task drawer opens on other pages (Chat, bell, Today, meeting notes); its stylesheets are the Projects page's own.
try {
  const pj = readFileSync(join(dist, 'projects', 'index.html'), 'utf8');
  const sheets = [...new Set(pj.match(/<link[^>]+rel="stylesheet"[^>]*>/g) || [])].map((m) => /href="([^"]+)"/.exec(m)?.[1]).filter((h) => h && h.startsWith('/_astro/'));
  mkdirSync(join(dist, '_app'), { recursive: true });
  writeFileSync(join(dist, '_app', 'projects-assets.json'), JSON.stringify({ css: sheets }));
} catch { /* no projects page in this build */ }
mkdirSync(join(dist, '_app'), { recursive: true });
writeFileSync(join(dist, '_app', 'layout-assets.json'), JSON.stringify(out));
console.log(`layout-assets: ${out.css.length} shared sheets, ${out.js.length} shared scripts across ${hub.length} hub pages`);
