// Run with: npm test
// Scheduled jobs on Admin > Overview: each job's status comes from the row the favor-work-drain Worker writes after every run.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const C = await import('../functions/_lib/admin/cronruns.ts');
const def = (id) => C.JOBS.find((j) => j.id === id);
const row = (o) => ({ job: 'x', last_run: o.last_ok || o.error_at, last_ok: null, last_error: null, error_at: null, detail: '', fails: 0, ms: 0, ...o });

describe('scheduled job status', () => {
  const now = Date.parse('2026-10-14T15:00:00Z'); // a Wednesday, 11 AM Eastern
  it('is ok right after a good run', () => {
    assert.equal(C.jobState(def('meetings'), row({ last_ok: '2026-10-14T14:55:00Z' }), now).status, 'ok');
  });
  it('is failed when the last run failed, with the count and the error', () => {
    const s = C.jobState(def('meetings'), row({ last_ok: '2026-10-14T14:50:00Z', error_at: '2026-10-14T14:55:00Z', last_error: '/api/meet/meetings/remind answered 500', fails: 2 }), now);
    assert.equal(s.status, 'failed');
    assert.match(s.detail, /Failed 2 runs in a row: .*answered 500/);
  });
  it('is late when overdue and failed at twice the gap', () => {
    assert.equal(C.jobState(def('meetings'), row({ last_ok: '2026-10-14T14:35:00Z' }), now).status, 'late');
    assert.equal(C.jobState(def('meetings'), row({ last_ok: '2026-10-14T14:00:00Z' }), now).status, 'failed');
  });
  it('is not late outside its hours or right after its window opens', () => {
    // The overnight sender runs 00:00 to 08:00 UTC; at 15:00 its 07:45 run is the latest and that is fine.
    assert.equal(C.jobState(def('drain'), row({ last_ok: '2026-10-14T07:45:00Z' }), now).status, 'ok');
    // The receipts list opens at 10:00 UTC; at 10:05 the 01:50 run is still fine.
    assert.equal(C.jobState(def('receipts-warm'), row({ last_ok: '2026-10-14T01:50:00Z' }), Date.parse('2026-10-14T10:05:00Z')).status, 'ok');
    // The morning email does not run on Saturday.
    assert.equal(C.jobState(def('digest'), row({ last_ok: '2026-10-09T14:50:00Z' }), Date.parse('2026-10-10T12:00:00Z')).status, 'ok');
    // On Monday at 12:00 UTC a morning email with no run since Friday is failed.
    assert.equal(C.jobState(def('digest'), row({ last_ok: '2026-10-09T14:50:00Z' }), Date.parse('2026-10-12T12:30:00Z')).status, 'failed');
  });
  it('a job with no row is unknown', () => {
    assert.equal(C.jobState(def('smoke'), undefined, now).status, 'unknown');
  });
});
