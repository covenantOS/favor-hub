// Run with: npm test
// New partner record pieces show to admins and the test accounts only (Will, 2026-10-15).
import assert from 'node:assert/strict';
import { it } from 'node:test';
import './support/resolve-ts.mjs';

const { recordPreview } = await import('../functions/_lib/work/preview.ts');
const wu = (email, role) => ({ user: { email, role } });

it('admins and the testers see the new pieces; staff do not', () => {
  assert.equal(recordPreview(wu('someone@favorintl.org', 'admin')), true);
  assert.equal(recordPreview(wu('tester@favorintl.org', 'staff')), true);
  assert.equal(recordPreview(wu('tester2@favorintl.org', 'staff')), true);
  assert.equal(recordPreview(wu('someone@favorintl.org', 'staff')), false);
});
