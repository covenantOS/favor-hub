// The web Worker holds the page's scripts back until its stylesheets have arrived (web/src/lib/defer-entry.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { deferEntry, rewriteHead } = await import('../web/src/lib/defer-entry.ts');

const HEAD = '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_w/a.css"/><link rel="modulepreload" href="/_w/index-1.js"/><link rel="modulepreload" href="/_w/react-2.js"/></head><body><main>Hello</main>';
const ENTRY = '<script type="module" async="" src="/_w/index-1.js"></script>';
const TAIL = '<div hidden id="S:1">late</div></body></html>';

async function run(parts) {
  const enc = new TextEncoder();
  const src = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
  return await new Response(deferEntry(src)).text();
}

describe('deferEntry', () => {
  it('replaces the entry script and the modulepreload links with a loader that waits for the stylesheets', async () => {
    const out = await run([HEAD + ENTRY + TAIL]);
    assert.ok(!out.includes('<link rel="modulepreload"'));
    assert.ok(!out.includes('<script type="module"'));
    assert.ok(out.includes('"/_w/index-1.js"') && out.includes('"/_w/react-2.js"'));
    assert.ok(out.includes('link[rel=stylesheet]') && out.includes('.sheet'));
    assert.ok(out.startsWith('<!DOCTYPE html>') && out.endsWith(TAIL));
    assert.ok(out.includes('<main>Hello</main>'));
  });
  it('finds the entry script when the stream splits it across chunks, and passes later chunks through untouched', async () => {
    const whole = HEAD + ENTRY;
    const cut = whole.length - 20;
    const out = await run([whole.slice(0, cut), whole.slice(cut), TAIL]);
    assert.ok(!out.includes('<script type="module"'));
    assert.ok(out.endsWith(TAIL));
  });
  it('keeps multibyte text whole across a split', async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode(HEAD + '<p>caf\u00e9 \u2014 ok</p>' + ENTRY + TAIL);
    const mid = Math.floor(bytes.length / 2);
    const src = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, mid)); c.enqueue(bytes.slice(mid)); c.close(); } });
    assert.ok((await new Response(deferEntry(src)).text()).includes('caf\u00e9 \u2014 ok'));
  });
  it('sends a page with no entry script as it came', async () => {
    const page = '<html><body>plain</body></html>';
    assert.equal(await run([page]), page);
    assert.equal(rewriteHead(page), null);
  });
});

describe('deferEntry with a repeat visitor', () => {
  it('leaves the page as drawn when the cookie names this build\'s entry, and rewrites it for any other build', async () => {
    const enc = new TextEncoder();
    const mk = () => new ReadableStream({ start(c) { c.enqueue(enc.encode(HEAD + ENTRY + TAIL)); c.close(); } });
    assert.equal(await new Response(deferEntry(mk(), 'a=1; hub_w=index-1.js')).text(), HEAD + ENTRY + TAIL);
    const other = await new Response(deferEntry(mk(), 'hub_w=index-0.js')).text();
    assert.ok(!other.includes('<script type="module"') && other.includes('hub_w'));
    assert.ok(!(await new Response(deferEntry(mk(), 'hub_w=index-1.jsx')).text()).includes('<script type="module"'));
  });
});
