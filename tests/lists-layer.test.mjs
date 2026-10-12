// The Lists page and the Favor Brain count the same people. This runs the Brain's own households statement (tests/fixtures/brain-layer.mjs,
// copied verbatim from covenantOS/favor-mcp) and the hub's port (functions/_lib/lists/layer.ts) on one invented mirror, then checks both against
// the KPI worker's rule written out in plain code (functions/_lib/reports/defs/lists-shared.ts, which mirrors donor-kpis.js).
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { householdsSnapshotSql } from '../functions/_lib/lists/layer.ts';
import { CREDIT_ROWS_SQL, addMonths, buildHouseholds, countStatus, groupGiving } from '../functions/_lib/reports/defs/lists-shared.ts';
import { brainHouseholdsSql } from './fixtures/brain-layer.mjs';
import { AS_OF, makeMirror } from './support/lists-fixture.mjs';

// The SQLite inside node 24 refuses a correlated column in a subquery's ORDER BY, which D1 (and so production) accepts. The fixture gives
// every record one address, so dropping that one ORDER BY term changes no row; both texts get the same edit.
const compat = (sql) => sql.replace('ORDER BY (x.id = p.primary_address_id) DESC, ', 'ORDER BY ');

let mirror;
let brain;
let hub;
before(() => {
  mirror = makeMirror();
  const b = brainHouseholdsSql(AS_OF);
  brain = mirror.prepare(compat(b.sql)).all(...b.params);
  const h = householdsSnapshotSql(AS_OF);
  hub = mirror.prepare(compat(h.sql)).all(...h.params);
});

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.household_id, r]));

describe('FavorOS layer is the Brain layer', () => {
  it('finds the same households', () => {
    assert.deepEqual(Object.keys(byId(hub)).sort(), Object.keys(byId(brain)).sort());
  });

  it('gives every shared column the same value for every household', () => {
    const b = byId(brain);
    for (const h of hub) {
      for (const k of Object.keys(h)) {
        if (k === 'zip' || k === 'last_gift_ly') continue; // added in FavorOS's copy
        assert.equal(h[k], b[h.household_id][k], `${h.household_id} ${k}`);
      }
    }
  });

  it('counts the same on the dashboard basis', () => {
    const count = (rows, s, alive) => rows.filter((r) => r.status === s && (!alive || r.alive === 1)).length;
    for (const s of ['active', 'LYBUNT', 'lapsed']) assert.equal(count(hub, s, true), count(brain, s, true), s);
  });
});

describe('the KPI rule, by hand, on the invented mirror', () => {
  it('matches the known answer', () => {
    const alive = hub.filter((r) => r.alive === 1);
    const n = (s) => alive.filter((r) => r.status === s).length;
    // active: Alice+Bob (one household), Carol (monthly payments count, the schedule row does not), Grace (the gift soft-credited to her), Jon+Kay.
    assert.equal(n('active'), 4);
    // LYBUNT: Dan (the 2027 gift is after the as-of day), Test Church, Henry. Lapsed: Eve (her $0 gift counts for nothing). Frank is deceased and left out.
    assert.equal(n('LYBUNT'), 3);
    assert.equal(n('lapsed'), 1);
    assert.equal(hub.filter((r) => r.alive === 0 && r.status === 'lapsed').length, 1);
  });

  it('agrees with the dashboard worker code path', () => {
    const q = (sql, p) => mirror.prepare(sql).all(...p);
    const credits = q(CREDIT_ROWS_SQL, [AS_OF]);
    const cons = q('SELECT id, spouse_id, deceased, inactive FROM constituents', []);
    const counts = countStatus(groupGiving(credits, buildHouseholds(cons)), addMonths(AS_OF, -12), addMonths(AS_OF, -24));
    const alive = hub.filter((r) => r.alive === 1);
    assert.equal(counts.lybunt, alive.filter((r) => r.status === 'LYBUNT').length);
    assert.equal(counts.lapsed, alive.filter((r) => r.status === 'lapsed').length);
    assert.equal(counts.active, hub.filter((r) => r.status === 'active').length);
  });

  it('puts a soft-credited gift on the partner, not the fund', () => {
    const ids = hub.map((r) => r.household_id);
    assert.ok(ids.includes('109'));
    assert.ok(!ids.includes('108'));
  });

  it('marks major at one gift of $1,000 or more', () => {
    assert.deepEqual(hub.filter((r) => r.major === 1).map((r) => r.household_id), ['110']);
  });

  it('keeps a spouse household as one row', () => {
    assert.equal(hub.filter((r) => ['101', '102'].includes(r.household_id)).length, 1);
    assert.equal(hub.find((r) => r.household_id === '101').lifetime, 150);
  });
});
