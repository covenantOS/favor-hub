// Run with: npm test
// Documents on a partner record answer only admins and the test accounts until Will opens them to staff (2026-10-15).
import assert from 'node:assert/strict';
import { it } from 'node:test';
import './support/resolve-ts.mjs';

const list = await import('../functions/api/work/partners/[id]/documents/index.ts');
const one = await import('../functions/api/work/partners/[id]/documents/[doc].ts');
const src = (p) => import('node:fs').then((fs) => fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

it('every documents route checks recordPreview before it reads or writes', async () => {
  for (const f of ['../functions/api/work/partners/[id]/documents/index.ts', '../functions/api/work/partners/[id]/documents/[doc].ts']) {
    const s = await src(f);
    const handlers = s.split('export const onRequest').slice(1);
    assert.ok(handlers.length >= 2);
    for (const h of handlers) assert.match(h.split('\n').slice(0, 2).join('\n'), /recordPreview\(wu\)/, 'the first line of each handler is the preview check');
  }
  assert.equal(typeof list.onRequestGet, 'function');
  assert.equal(typeof one.onRequestDelete, 'function');
});
