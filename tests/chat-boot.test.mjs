import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const ctx = { window: {}, document: {}, Intl, matchMedia: () => ({ matches: false }) };
createContext(ctx);
runInContext(readFileSync(new URL('../public/js/chat/chat-ui.js', import.meta.url), 'utf8'), ctx);

test('chat boot markup is the real frame: side list, head, messages, composer, no sentences', () => {
  const h = ctx.window.FavorChat.bootHtml();
  for (const c of ['ch-side', 'ch-pnav', 'ch-seg', 'ch-list', 'ch-main', 'ch-head', 'ch-msgs', 'ch-comp', 'ch-right']) assert.ok(h.includes(c), c);
  assert.ok(!h.includes('—'));
});

test('the page ships the boot markup and the phone list view before any script runs', () => {
  const page = readFileSync(new URL('../src/pages/chat/index.astro', import.meta.url), 'utf8');
  assert.match(page, /id="chat-root" class="ch" data-view="list" data-boot/);
  assert.match(page, /bootHtml\(\)/);
});
