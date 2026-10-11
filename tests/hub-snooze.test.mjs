// Snooze on Today and the ? help button: the date rules, the hidden-card lookup, and every page's help article exists.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import './support/resolve-ts.mjs';

const { addDays, validSnoozeDate, snoozedKeys } = await import('../functions/_lib/hub/snooze.ts');
const { AREAS } = await import('../src/data/areas.ts');

test('addDays counts calendar days across month and year ends', () => {
  assert.equal(addDays('2026-10-10', 1), '2026-10-11');
  assert.equal(addDays('2026-10-10', 7), '2026-10-17');
  assert.equal(addDays('2026-10-28', 7), '2026-11-04');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('a snooze date is after today and within two years', () => {
  assert.equal(validSnoozeDate('2026-10-11', '2026-10-10'), '2026-10-11');
  assert.equal(validSnoozeDate('2026-10-10', '2026-10-10'), null, 'today is not a snooze');
  assert.equal(validSnoozeDate('2026-10-09', '2026-10-10'), null, 'the past is not a snooze');
  assert.equal(validSnoozeDate('2028-10-11', '2026-10-10'), null, 'more than two years out');
  assert.equal(validSnoozeDate('10/11/2026', '2026-10-10'), null, 'only YYYY-MM-DD');
  assert.equal(validSnoozeDate(undefined, '2026-10-10'), null);
});

test('snoozedKeys returns the keys still hidden today, and hides nothing when the table cannot be read', async () => {
  const seen = [];
  const env = {
    DB: {
      prepare(sql) {
        seen.push(sql);
        return { bind: (...args) => ({ all: async () => ({ results: [{ item_key: 'card:requests' }] }), args }) };
      },
    },
  };
  const keys = await snoozedKeys(env, 'Will@FavorIntl.org', '2026-10-10');
  assert.deepEqual([...keys], ['card:requests']);
  assert.match(seen[0], /until_date > \?/, 'a card comes back on its day, so only later dates hide it');

  const broken = { DB: { prepare() { throw new Error('no such table: hub_snoozes'); } } };
  assert.equal((await snoozedKeys(broken, 'a@favorintl.org', '2026-10-10')).size, 0);
});

test('every page with a Learn link points at a help article that exists', () => {
  const dir = path.join(process.cwd(), 'src', 'content', 'help');
  const missing = [];
  for (const area of AREAS) {
    for (const p of area.pages) {
      if (p.learn && !fs.existsSync(path.join(dir, `${p.learn}.md`))) missing.push(`${p.id} -> ${p.learn}`);
    }
  }
  assert.deepEqual(missing, []);
});
