import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/js/wc-bell.js', import.meta.url), 'utf8');
const today = readFileSync(new URL('../functions/_lib/hub/today.ts', import.meta.url), 'utf8');
const note = readFileSync(new URL('../functions/_lib/hub/notifications.ts', import.meta.url), 'utf8');

test('the badge counts unread rows and caps at 9+', () => {
  assert.match(js, /n > 9 \? '9\+'/);
  assert.match(js, /bellRows\(\)\.fresh\.length/);
});
test('rows group only as New and Earlier, with one empty state', () => {
  assert.match(js, /group\('New'/);
  assert.match(js, /group\('Earlier'/);
  assert.match(js, /You are all caught up\./);
});
test('the print file belongs to its maker, not to every admin', () => {
  const fn = today.slice(today.indexOf('function fileIsMine'), today.indexOf('export function receiptsFigure'));
  assert.ok(!/access\.admin/.test(fn));
});
test('meetings show 15 minutes ahead', () => {
  assert.match(note, /Date\.now\(\) \+ 15 \* 60_000/);
});
