// Run with: npm test
//
// Grants: a report names the award it belongs to, and a conversation is the Grants Action type. Made-up ids.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './support/resolve-ts.mjs';

const G = await import('../functions/_lib/work/grants.ts');

test('a report belongs to the award closest before it, a name with the year winning', () => {
  const awards = [
    { id: '1', cid: '50', name: 'Wells grant (2025)', status: 'Awarded - Closed', amount: 10000, d: '2025-03-01' },
    { id: '2', cid: '50', name: 'Bible schools grant (2026)', status: 'Awarded - Active', amount: 25000, d: '2026-02-01' },
    { id: '3', cid: '51', name: 'Other', status: 'Awarded - Active', amount: 5, d: '2026-01-01' },
  ];
  assert.equal(G.awardFor({ cid: '50', date: '2026-10-21' }, awards).id, '2');
  assert.equal(G.awardFor({ cid: '50', date: '2025-11-01' }, awards).id, '1');
  assert.equal(G.awardFor({ cid: '52', date: '2026-10-21' }, awards), null);
});

test('a conversation is a Grants Action and can be a call or a meeting', () => {
  assert.equal(G.KIND_TYPE.conversation, 'Grants Action');
  assert.equal(G.kindOfType('Grants Action'), 'conversation');
  assert.equal(G.HOW_CATEGORY.call, 'Phone call');
  assert.equal(G.HOW_CATEGORY.meeting, 'Meeting');
});
