import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePolicy } from 'lintapple';

const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

test('ui-policy.json is a valid lintapple policy', async () => {
  validatePolicy(await read('../ui-policy.json'));
});

test('every device profile override still makes a valid policy', async () => {
  const base = await read('../ui-policy.json');
  const profiles = await read('./ui/profiles.json');
  for (const [name, o] of Object.entries(profiles)) {
    validatePolicy({ ...base, ...o, typeRules: [...(o.typeRules || []), ...base.typeRules] });
    assert.ok(['phone', 'ipad', 'desktop'].includes(name), name);
  }
});

test('the sweep never commits a cookie', async () => {
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /tests\/ui\/\.cookies\.json/);
});
