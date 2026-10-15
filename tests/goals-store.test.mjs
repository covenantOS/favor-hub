// Run with: npm test
// Fundraiser goals kept in FavorOS: the team roll-up follows the KPI dashboard's rules, and a save is validated and audited.
// Made-up names and amounts only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { teamGoals, yearShare } = await import('../functions/_lib/goals/store.ts');

const rows = [
  { type: 'Executive Director', lead: false, start: null, end: null, goal: 9_000_000 },
  { type: 'Regional Development Director (RDD)', lead: false, start: null, end: null, goal: 1_000_000 },
  { type: 'Regional Development Director (RDD)', lead: false, start: '2026-07-01', end: null, goal: 1_000_000 },
  { type: 'Regional Development Director (RDD)', lead: true, start: null, end: '2026-06-30', goal: 1_500_000 },
  { type: 'Foundation Steward', lead: true, start: null, end: null, goal: 3_000_000 },
  { type: 'Foundation Steward', lead: false, start: null, end: null, goal: 55 },
  { type: 'Partner Care', lead: true, start: null, end: null, goal: 360_000 },
  { type: 'Church Engagement Director', lead: true, start: null, end: null, goal: 370_000 },
  { type: 'Marketing', lead: true, start: null, end: null, goal: 500_000 },
  { type: 'Marketing', lead: false, start: null, end: null, goal: null },
];

describe('team goals from per-fundraiser goals', () => {
  it('prorates each RDD by the share of the year on the team and reads team leads for the other teams', () => {
    const g = teamGoals(rows, 2026, '2026-10-14');
    // Full year 1,000,000 + July to December 184 of 365 days + January to June 181 of 365 days at 1,500,000.
    const expectedRdd = Math.round(1_000_000 + 1_000_000 * (184 / 365) + 1_500_000 * (181 / 365));
    assert.equal(g.rdd, expectedRdd);
    assert.equal(g.exec, 9_000_000);
    assert.equal(g.grants, 3_000_000);
    assert.equal(g.pc, 360_000);
    assert.equal(g.ce, 370_000);
    assert.equal(g.mk, 500_000);
  });

  it('skips an Executive Director whose end date has passed', () => {
    const g = teamGoals([{ type: 'Executive Director', lead: false, start: null, end: '2026-01-31', goal: 5 }, { type: 'Executive Director', lead: false, start: null, end: null, goal: 7 }], 2026, '2026-10-14');
    assert.equal(g.exec, 7);
  });

  it('gives zero for a team with no lead goal', () => {
    const g = teamGoals([{ type: 'Partner Care', lead: false, start: null, end: null, goal: 10 }], 2026, '2026-10-14');
    assert.equal(g.pc, 0);
  });

  it('counts a whole year as 1 and a person who left before the year as 0', () => {
    assert.equal(yearShare(null, null, 2026), 1);
    assert.equal(yearShare(null, '2025-12-31', 2026), 0);
  });
});
