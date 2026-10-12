// Run with: npm test
//
// The Daily Revenue Report built from a gift entry deposit's own rows (functions/_lib/gifts/revenue.ts): held, rejected and removed rows
// are left out, a row with no partner is left out, and a partner with nothing in the mirror yet reads as a new partner. The mirror is a
// stub that knows nobody. Made-up ids and amounts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { asRawGifts } = await import('../functions/_lib/gifts/revenue.ts');
const { loadGrid, buildPost } = await import('../functions/_lib/reports/defs/b1-shared.ts');

const row = (id, over) => ({ id, seq: 1, status: 'sent', kind: 'check', partner_id: '900', amount_cents: 10000, gift_date: null, fund_id: '79', appeal_id: '2185', soft_partner_id: null, bb_gift_id: null, ...over });

describe('the revenue report from a deposit', () => {
  it('counts the rows in the batch and leaves out held, rejected, removed and partnerless rows', () => {
    const g = asRawGifts([row('a', {}), row('b', { status: 'held' }), row('c', { status: 'rejected' }), row('d', { status: 'removed' }), row('e', { partner_id: null }), row('f', { kind: 'cash', amount_cents: 2550 })], '2026-10-12');
    assert.deepEqual(g.map((x) => [x.id, x.amount, x.d, x.pm]), [['ge:a', 100, '2026-10-12', 'PersonalCheck'], ['ge:f', 25.5, '2026-10-12', 'Cash']]);
    assert.deepEqual(JSON.parse(g[0].splits), [{ amount: { value: 100 }, appeal_id: '2185', fund_id: '79' }]);
  });
  it('builds the post from the given gifts, and a partner the mirror does not know is new', async () => {
    const ctx = { sql: async () => [], today: '2026-10-12' };
    const grid = await loadGrid(ctx, '2026-10-12', '2026-10-12', 5000, asRawGifts([row('a', { amount_cents: 500000 }), row('b', { partner_id: '901', amount_cents: 2500 })], '2026-10-12'));
    const post = buildPost(grid, 15);
    assert.equal(post.total, 5025);
    assert.equal(post.count, 2);
    assert.match(post.text, /Total received: \$5,025 from 2 gifts/);
    assert.ok(post.gifts.every((p) => p.newPartner), 'both partners are new');
  });
});
