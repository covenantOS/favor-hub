// The product is named FavorOS. "Favor Hub" must not appear in any user-visible string.
// If this fails after a merge, run: node tools/rename-favoros.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = new Set(['.ts', '.js', '.mjs', '.astro', '.md', '.json', '.html', '.webmanifest']);
const SKIP = new Set(['node_modules', 'dist', '.astro', '.wrangler']);
const COMMENT = /^\s*(\/\/|\*|\/\*|<!--)/;
const NARRATED = /^\s*"transcript"/;

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    if (SKIP.has(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(extname(n))) out.push(p);
  }
  return out;
}

test('no user-visible "Favor Hub"', () => {
  const hits = [];
  for (const dir of ['src', 'public', 'functions', 'workers']) {
    for (const f of walk(join(ROOT, dir))) {
      const code = !['.md', '.json', '.webmanifest'].includes(extname(f));
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if ((code && COMMENT.test(line)) || NARRATED.test(line)) return;
        if (/Favor [Hh]ub\b/.test(line)) hits.push(`${f.slice(ROOT.length)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});

test('the rename script has nothing left to change', () => {
  const out = execFileSync(process.execPath, ['tools/rename-favoros.mjs', '--dry'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /would change 0 files/, out);
});

test('manifest and home screen title say FavorOS', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'FavorOS');
  assert.equal(m.short_name, 'FavorOS');
  assert.match(readFileSync(join(ROOT, 'src/layouts/App.astro'), 'utf8'), /apple-mobile-web-app-title" content="FavorOS"/);
});
