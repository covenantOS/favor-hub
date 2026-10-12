// Run with: npm test
//
// Every partner name on a report table opens the partner card: the report engine gives each row its partner's record id as __cid, from
// an id the row carries or from its Partner ID through the mirror. Made-up ids.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './support/resolve-ts.mjs';

const { withPartnerIds } = await import('../functions/_lib/reports/engine.ts');

test('rows get __cid from their own id or their Partner ID; reports with no partner column are left alone', async () => {
  const asked = [];
  const ctx = { sql: async (sql, p) => { asked.push(p); return [{ id: '7001', lk: 'L55' }]; } };
  const rows = [{ partner: 'A', cid: '7000' }, { partner: 'B', lookup: 'L55' }, { partner: 'C', lookup: 'L99' }, { partner: 'D', __cid: '7002' }];
  await withPartnerIds(ctx, { columns: [{ key: 'partner', label: 'Partner' }] }, rows);
  assert.deepEqual(rows.map((r) => r.__cid), ['7000', '7001', undefined, '7002']);
  assert.deepEqual(asked, [[JSON.stringify(['L55', 'L99'])]]);
  const other = [{ fund: 'X', cid: '1' }];
  await withPartnerIds(ctx, { columns: [{ key: 'fund', label: 'Fund' }] }, other);
  assert.equal(other[0].__cid, undefined);
});
