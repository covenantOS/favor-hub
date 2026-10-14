// Run with: npm test
// The favor-work-drain Worker records every job: a success sets last_ok and clears the fails count, a failure keeps last_ok and counts up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { memoryD1 } from './support/d1.mjs';

const W = await import('../workers/favor-work-drain/src/index.js');

describe('drain worker job record', () => {
  it('writes ok, then a failure with the error, then ok again', async () => {
    const db = memoryD1();
    db.exec(readFileSync(new URL('../db/cron-runs.sql', import.meta.url), 'utf8'));
    const env = { DB: db };
    const err = console.error;
    console.error = () => {};
    try {
      assert.equal(await W.job(env, 'lists', async () => 'done'), true);
      let r = db.db.prepare("SELECT * FROM hub_cron_runs WHERE job = 'lists'").get();
      assert.equal(r.detail, 'done');
      assert.equal(r.fails, 0);
      const ok1 = r.last_ok;
      assert.equal(await W.job(env, 'lists', async () => { throw new Error('/api/lists/refresh answered 500: boom'); }), false);
      assert.equal(await W.job(env, 'lists', async () => { throw new Error('again'); }), false);
      r = db.db.prepare("SELECT * FROM hub_cron_runs WHERE job = 'lists'").get();
      assert.equal(r.fails, 2);
      assert.equal(r.last_ok, ok1);
      assert.equal(r.last_error, 'again');
      await W.job(env, 'lists', async () => '');
      r = db.db.prepare("SELECT * FROM hub_cron_runs WHERE job = 'lists'").get();
      assert.equal(r.fails, 0);
    } finally {
      console.error = err;
    }
  });
  it('lists every job the Worker records on the health strip', () => {
    const src = readFileSync(new URL('../workers/favor-work-drain/src/index.js', import.meta.url), 'utf8');
    const used = new Set([...src.matchAll(/(?:job\(env, |logged\()'([a-z-]+)'/g)].map((m) => m[1]));
    const listed = readFileSync(new URL('../functions/_lib/admin/cronruns.ts', import.meta.url), 'utf8');
    for (const id of used) assert.match(listed, new RegExp(`id: '${id}'`), id + ' is not on the health strip');
  });
});
