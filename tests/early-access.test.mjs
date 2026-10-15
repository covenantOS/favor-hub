// Early access (src/data/early.ts): the registry flags agree with the release badges, and the held addresses are exactly the early pages.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const { AREAS } = await import('../src/data/areas.ts');
const { earlyOnly, earlyPaths } = await import('../src/data/early.ts');

test('every page flagged early is early by the badge rules, and the other way round', () => {
  for (const a of AREAS) for (const p of a.pages) assert.equal(!!p.early, earlyOnly(a.id, p.id), `${a.id}/${p.id}`);
});

test('Projects, the Brain, Today, Partners and Gifts stay open to staff', () => {
  for (const id of ['projects', 'ask', 'today', 'partners', 'gifts', 'staff']) {
    const a = AREAS.find((x) => x.id === id);
    assert.ok(a.pages.some((p) => !p.early), id);
  }
  assert.equal(AREAS.find((a) => a.id === 'projects').pages.every((p) => !p.early), true);
  assert.equal(AREAS.find((a) => a.id === 'ask').pages.every((p) => !p.early), true);
});

test('Meetings, Chat, Mail and Clips are held, and the room an invited person opens is not', () => {
  const held = earlyPaths(AREAS);
  for (const path of ['/meet/', '/chat/', '/mail/', '/clips/']) assert.ok(held.has(path), path);
  assert.equal(held.has('/meet/room/'), false);
  assert.equal(held.has('/projects/'), false);
  assert.equal(held.has('/brain/'), false);
});
