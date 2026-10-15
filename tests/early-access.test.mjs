// Early access (src/data/early.ts): the registry flags agree with the release badges, and the held addresses are exactly the early pages.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const { AREAS } = await import('../src/data/areas.ts');
const { earlyPaths } = await import('../src/data/early.ts');

test('Today, Partners, Gifts, Projects requests, Staff, Reporting and Help stay open to staff', () => {
  for (const id of ['today', 'partners', 'gifts', 'projects', 'staff', 'kpi', 'help']) {
    const a = AREAS.find((x) => x.id === id);
    assert.ok(a.pages.some((p) => !p.early), id);
  }
  const ids = AREAS.flatMap((a) => a.pages.filter((p) => !p.early).map((p) => p.id));
  for (const id of ['request-new', 'my-requests', 'clips', 'kpi', 'reports', 'kpi-definitions', 'expenses']) assert.ok(ids.includes(id), id);
});

test('Meetings, Chat, Mail are held, and the room an invited person opens is not', () => {
  const held = earlyPaths(AREAS);
  for (const path of ['/meet/', '/chat/', '/mail/', '/moves/', '/data-care/', '/highlights/']) assert.ok(held.has(path), path);
  for (const path of ['/meet/room/', '/clips/', '/projects/', '/reports/']) assert.equal(held.has(path), false, path);
});
