import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// stage.js is a classic browser script. Run it in a sandbox the way a page would.
const box = { Math, Object, JSON, Array };
box.window = box;
vm.createContext(box);
vm.runInContext(readFileSync(new URL('../public/js/meet/stage.js', import.meta.url), 'utf8'), box);
const M = box.MeetStage;
const P = (pid, me) => ({ pid, name: pid, me: !!me });
const me = P('me', true), ann = P('ann'), ben = P('ben'), cy = P('cy'), di = P('di'), ed = P('ed');
const share = { key: 'share:ann', kind: 'share', p: ann };
const play = { key: 'play', kind: 'play', p: { pid: 'play' } };
const view = (o) => M.clean(o);
const kinds = (r) => r.model.map((x) => x.key + ':' + x.kind).join(' ');

test('saved choices fall back to the defaults when missing or out of range', () => {
  const v = M.clean({ mode: 'weird', strip: 'top', side: 9999, bottom: 1, float: { x: 4, y: -1, w: 0.01 } });
  assert.equal(v.mode, 'auto'); assert.equal(v.strip, 'side'); assert.equal(v.side, 640); assert.equal(v.bottom, 80);
  assert.equal(v.float.x, 1); assert.equal(v.float.y, 0); assert.equal(v.float.w, 0.16);
  const mem = { s: {}, getItem(k) { return this.s[k] || null; }, setItem(k, v) { this.s[k] = v; } };
  M.save({ mode: 'speaker', hideSelf: true }, mem);
  assert.equal(M.load(mem).mode, 'speaker'); assert.equal(M.load(mem).hideSelf, true);
});

test('auto view: gallery with no share, share on the stage with faces beside it', () => {
  assert.equal(kinds(M.arrange({ faces: [me, ann, ben], view: view(), cap: 4 })), 'me:tile ann:tile ben:tile');
  const r = M.arrange({ faces: [me, ann, ben], content: share, view: view(), cap: 4 });
  assert.equal(r.spot, true);
  assert.equal(kinds(r), 'share:ann:big me:strip ann:strip ben:strip');
});

test('the strip holds what fits and a count of the rest', () => {
  const r = M.arrange({ faces: [me, ann, ben, cy, di, ed], content: share, view: view(), cap: 3 });
  assert.equal(kinds(r), 'share:ann:big me:strip ann:strip more:more');
  assert.equal(r.model[3].n, 4);
});

test('gallery view puts the share in a tile among the faces', () => {
  const r = M.arrange({ faces: [me, ann], content: share, view: view({ mode: 'gallery' }), perPage: 9 });
  assert.equal(kinds(r), 'share:ann:tile me:tile ann:tile');
});

test('hiding the share shows only faces and reports what is hidden', () => {
  const r = M.arrange({ faces: [me, ann, ben], content: play, view: view(), room: { stage: 'hidden' } });
  assert.equal(kinds(r), 'me:tile ann:tile ben:tile');
  assert.equal(r.hidden.key, 'play');
});

test('the small window floats over a gallery of faces', () => {
  const r = M.arrange({ faces: [me, ann, ben], content: share, view: view(), room: { stage: 'mini' } });
  assert.equal(kinds(r), 'me:tile ann:tile ben:tile share:ann:float');
  assert.equal(r.spot, false);
});

test('swap puts a face on the stage and the share first in the strip', () => {
  const r = M.arrange({ faces: [me, ann, ben], content: share, big: 'ben', view: view(), room: { stage: 'normal', swap: true }, cap: 4 });
  assert.equal(kinds(r), 'ben:big share:ann:strip me:strip ann:strip');
  // With nobody picked, the first person in the order.
  const r2 = M.arrange({ faces: [ann, me], content: share, view: view(), room: { stage: 'normal', swap: true }, cap: 4 });
  assert.equal(r2.model[0].key, 'ann');
});

test('hide self view removes my tile unless I am alone', () => {
  assert.equal(kinds(M.arrange({ faces: [me, ann], view: view({ hideSelf: true }) })), 'ann:tile');
  assert.equal(kinds(M.arrange({ faces: [me], view: view({ hideSelf: true }) })), 'me:tile');
});

test('a local pin puts that person on the stage; spotlight view drops the strip', () => {
  assert.equal(kinds(M.arrange({ faces: [ben, me, ann], big: 'ben', view: view(), cap: 4 })), 'ben:big me:strip ann:strip');
  assert.equal(kinds(M.arrange({ faces: [me, ann, ben], big: 'ann', view: view({ mode: 'spotlight' }) })), 'ann:big');
  assert.equal(kinds(M.arrange({ faces: [me, ann], content: share, view: view({ mode: 'spotlight' }) })), 'share:ann:big');
});

test('a clip on the stage with a share as well: the share leads the faces', () => {
  const r = M.arrange({ faces: [me, ann], content: play, extra: share, view: view(), cap: 4 });
  assert.equal(kinds(r), 'play:big share:ann:strip me:strip ann:strip');
});

test('gallery pages', () => {
  const r = M.arrange({ faces: [me, ann, ben, cy, di], view: view(), perPage: 2, page: 5 });
  assert.equal(r.pages, 3); assert.equal(r.page, 2); assert.equal(kinds(r), 'di:tile');
});

test('strip capacity follows the strip size, and the floating box stays inside the stage', () => {
  assert.equal(M.stripCap('side', 220, 1000, 700, 8), 6);
  assert.equal(M.stripCap('side', 600, 1000, 700, 8), 2);
  assert.equal(M.stripCap('bottom', 150, 1200, 700, 8), 5);
  const b = M.floatBox({ x: 1, y: 1, w: 0.3 }, 1000, 600);
  assert.deepEqual([b.x + b.w, b.y + b.h], [1000, 600]);
  const f = M.floatFrac(b.x, b.y, b.w, 1000, 600);
  assert.ok(Math.abs(f.x - 1) < 0.01 && Math.abs(f.y - 1) < 0.01 && Math.abs(f.w - 0.3) < 0.01);
});
