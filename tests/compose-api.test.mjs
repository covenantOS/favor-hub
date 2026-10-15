// The shared composer (public/js/compose/compose.js) and the Brain's Send to email and Drag (public/js/ask-brain.js).
// 2026-10-14: Send to email and dropping on "Drop here to start an email" did nothing, because add() declared a local
// `var open` that hid the composer's open() and threw "open is not a function". These checks keep that and the public API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../public/js/compose/compose.js', import.meta.url), 'utf8');
const brain = readFileSync(new URL('../public/js/ask-brain.js', import.meta.url), 'utf8');

test('compose.js parses', () => {
  assert.doesNotThrow(() => new vm.Script(src));
  assert.doesNotThrow(() => new vm.Script(brain));
});

test('no local variable named open hides the composer open()', () => {
  assert.ok(!/(\bvar|\blet|\bconst|,)\s*open\s*=[^=]/.test(src), 'a variable named open shadows open()');
});

test('the public API keeps its names for the React port', () => {
  const api = src.slice(src.indexOf('window.FavorCompose = {'));
  for (const k of ['open:', 'add:', 'host:', 'list:', 'focus:', 'close:', 'toast:', 'itemHtml:', 'itemText:', 'dragStart:', 'pointerDrag:', 'copy:', 'ITEM_TYPE:']) assert.ok(api.includes(k), k);
});

test('Send to email asks which draft when drafts are open, New email first', () => {
  assert.match(src, /data-fc-pick="new"/);
  assert.match(src, /Add to which email\?/);
  assert.match(src, /toast\('Added to email'\)/);
});

test('Brain answers carry the Source line and the partner rule', () => {
  assert.match(src, /Source: Favor Brain, as of /);
  assert.match(src, /it\.partner && !it\.mayShare/);
  assert.match(brain, /pointerDrag/);
  assert.match(brain, /data-brain-copyf/);
});

test('the layout asset list skips script tags written by a script', async () => {
  const s = readFileSync(new URL('../scripts/app-layout-css.mjs', import.meta.url), 'utf8');
  assert.match(s, /\/\['\+\\s\]\/\.test\(src\)/);
});
