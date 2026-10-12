// Text Favor Brain settings: the proxy lists its four routes, the page carries every id the script reads, and a text link opens its thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the Brain proxy allows the four text routes and nothing wider', () => {
  const src = read('functions/api/brain/[[path]].ts');
  for (const r of ['GET text/status', 'POST text/register', 'POST text/confirm', 'POST text/remove']) assert.ok(src.includes(`'${r}'`), r);
  assert.ok(!/'(GET|POST) text\/\*/.test(src));
});

test('every id the script reads is on the page', () => {
  const page = read('src/pages/brain/text/index.astro');
  const js = read('public/js/brain-text.js');
  for (const id of new Set([...js.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1]))) assert.ok(page.includes(`id="${id}"`), id);
});

test('a text link (?t=) opens its thread on the Brain page', () => {
  assert.match(read('public/js/brain.js'), /get\('c'\) \|\| new URLSearchParams\(location\.search\)\.get\('t'\)/);
});

test('the help article and the tour step exist', () => {
  assert.match(read('src/content/help/text-favor-brain.md'), /^title: Text Favor Brain/m);
  assert.match(read('src/scripts/tours.ts'), /id: 'brain-text'[\s\S]*added: '2026-10-12'/);
  assert.match(read('src/content/help/whats-new.md'), /Text Favor Brain/);
});

test('staff-facing text has no em dashes and never says donors or AI', () => {
  for (const p of ['src/pages/brain/text/index.astro', 'public/js/brain-text.js', 'src/content/help/text-favor-brain.md']) {
    const t = read(p);
    assert.ok(!/[—–]/.test(t), `${p} has a dash`);
    assert.ok(!/\bdonors?\b/i.test(t) && !/\bAI\b/.test(t), `${p} wording`);
  }
});
