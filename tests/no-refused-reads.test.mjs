// Pages must not send a read the server refuses for the person's role, so a staff console stays clean (no 403 for Church Engagement).
// The server gates are untouched; these checks pin the client side.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('the Work Center chips read Gift images only for a role that has the tab', () => {
  const src = read('web/src/features/partners/work/WorkHeader.tsx');
  assert.match(src, /giftImagesQuery\(as\), enabled: hasTab\('giftimages', me\)/);
  const tabs = read('web/src/features/partners/work/actions/tabs.ts');
  assert.match(tabs, /giftimages: \(me\) => me\.role === 'admin' \|\| me\.role === 'support'/);
});

test('Today reads the gift day only after the menu says the person has gift entry', () => {
  const src = read('web/src/features/today/Modules.tsx');
  assert.match(src, /ensureQueryData\(navQuery\)/);
  assert.match(src, /giftEntry === true \? soft\('\/api\/gifts\/overview'\)/);
  const classic = read('public/js/today-giftday.js');
  assert.match(classic, /access\.giftEntry !== true/);
  assert.match(classic, /'favor-hub'/);
});
