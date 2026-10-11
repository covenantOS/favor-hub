// Runs after `astro build`. Stamps every hub script and stylesheet address in dist with the build id, so a browser that kept
// an old copy can never run it against a newer page. Covers script and link tags in the HTML, relative imports between the
// modules in dist/js, and /js/... addresses written inside scripts (the clip launcher loads one that way).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const root = decodeURIComponent(dist.pathname).replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);
const version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8'));
const build = String(version.build || Date.now());
const tag = (url) => {
  if (/[?&]b=\d+/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'b=' + build;
};

let pages = 0;
let scripts = 0;
for (const f of files) {
  if (f.endsWith('.html')) {
    const src = readFileSync(f, 'utf8');
    const out = src.replace(/((?:src|href)=")(\/(?:js|css)\/[^"#]+\.(?:js|css)(?:\?[^"#]*)?)(")/g, (m, a, url, z) => a + tag(url) + z);
    if (out !== src) { writeFileSync(f, out); pages++; }
  } else if (f.endsWith('.js') && /[\\/]js[\\/]/.test(f)) {
    const src = readFileSync(f, 'utf8');
    let out = src.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]+\.js)\2/g, (m, a, q, url) => a + q + tag(url) + q);
    out = out.replace(/(['"`])(\/js\/[A-Za-z0-9_\/.-]+\.js(?:\?v=\d+)?)\1/g, (m, q, url) => q + tag(url) + q);
    if (out !== src) { writeFileSync(f, out); scripts++; }
  }
}
console.log(`stamp-build: build ${build}, ${pages} pages, ${scripts} scripts`);
