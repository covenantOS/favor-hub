// The Chat screen (chat-ui.js) talks to an injected api; chat.js is the real one. Every call the screen makes has a method behind it,
// every method points at a route the router answers, and the page, nav entry, tour step and help article exist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';

const ui = fs.readFileSync('public/js/chat/chat-ui.js', 'utf8');
const real = fs.readFileSync('public/js/chat/chat.js', 'utf8');
const router = fs.readFileSync('functions/_lib/chat/route.ts', 'utf8') + fs.readFileSync('functions/_lib/chat/smart-route.ts', 'utf8');

test('every api method the screen calls is defined by the real transport', () => {
  const used = new Set([...ui.matchAll(/\bapi\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
  assert.ok(used.size > 15);
  for (const name of used) assert.ok(real.includes(`${name}: function`), `chat.js lacks api.${name}`);
});

test('every path the transport calls is a route the router handles', () => {
  const paths = [...real.matchAll(/req\('(GET|POST|PATCH|DELETE)', '([a-z]+)/g)].map((m) => m[2]);
  for (const p of new Set(paths)) assert.match(router, new RegExp(`a === '${p}'`), `no route for ${p}`);
});

test('the screen sends no inline styles that say meta commentary, em dashes or AI wording', () => {
  for (const [name, src] of [['chat-ui.js', ui], ['chat.js', real], ['chat.css', fs.readFileSync('src/styles/chat.css', 'utf8')]]) {
    assert.ok(!src.includes('\u2014'), `${name} has an em dash`);
    assert.ok(!/\bAI\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), `${name} mentions AI`);
  }
});

test('Chat has a page, a gated nav entry, a tour step, a help article and a What\'s new line', async () => {
  const { AREAS } = await import('../src/data/areas.ts');
  const chat = AREAS.find((a) => a.id === 'chat');
  assert.ok(chat);
  assert.equal(chat.pages[0].need, 'chat');
  assert.ok(fs.existsSync('src/pages/chat/index.astro'));
  const help = fs.readFileSync('src/content/help/chat.md', 'utf8');
  assert.match(help, /title: Chat/);
  assert.ok(!help.includes('\u2014'));
  assert.match(fs.readFileSync('src/content/help/whats-new.md', 'utf8'), /\*\*Chat, for admins\.\*\*/);
  assert.match(fs.readFileSync('web/src/features/tour/data.ts', 'utf8'), /id: 'chat',[\s\S]*?need: 'chat'/);
});
