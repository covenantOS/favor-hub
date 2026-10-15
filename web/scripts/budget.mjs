// The first-screen JavaScript budget for every web page: the entry chunk (router, Start, the shell and anything a route file pulls in
// outside its own component) stays under the cap, gzipped. A route's own code belongs in its component, which the router loads on its
// own; queries and loaders go in a separate module that imports no components. Runs after every web build in the ship scripts.
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAP_KB = 100;
const dir = fileURLToPath(new URL('../dist/client/_w', import.meta.url));
const entry = readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
let worst = 0;
for (const f of entry) worst = Math.max(worst, gzipSync(readFileSync(dir + '/' + f)).length);
const kb = Math.round(worst / 1024);
if (kb > CAP_KB) {
  console.error(`budget: the web entry chunk is ${kb} KB gzipped, over the ${CAP_KB} KB cap. Something heavy is imported by __root.tsx, the shell, or a route file outside its component (often a loader importing from the page's component module). Move it behind lazy() or into a queries module.`);
  process.exit(1);
}
// A stylesheet that a route file or the shell imports for its side effect rides in the entry, so every page downloads it before it can
// paint. The entry takes no stylesheet of its own: page styles belong to the page's component, or to a route's head link (?url).
const entryCss = readdirSync(dir).filter((f) => /^index-.*\.css$/.test(f));
if (entryCss.length) {
  console.error(`budget: the entry chunk carries a stylesheet (${entryCss.join(', ')}). A module the entry imports pulls in page CSS (a route file importing a feature module that imports .css). Import only light modules at the top of a route file.`);
  process.exit(1);
}
console.log(`budget: web entry chunk ${kb} KB gzipped (cap ${CAP_KB} KB)`);
