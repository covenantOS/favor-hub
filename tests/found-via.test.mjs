// Run with: npm test
//
// How a first-time partner found Favor: the first gift's appeal, its website form, and the source code once the mirror carries one.
// An in-memory copy of the mirror's tables; every name, id and amount is made up.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const F = await import('../functions/_lib/work/found-via.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');

function world(withSource) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT, gift_splits TEXT${withSource ? ', source_code TEXT' : ''});
    CREATE TABLE appeals (id TEXT, appeal_id TEXT, appeal_description TEXT, appeal_category TEXT);
    CREATE TABLE gift_custom_fields (id TEXT, gift_id TEXT, category TEXT, value TEXT);
    INSERT INTO appeals VALUES ('10', 'N269-EMW3', 'Digital Newsletter, September 2026, Week 3, Email Newsletter, Wells for Chad', 'Digital Newsletter');
    INSERT INTO appeals VALUES ('11', 'S267-DRHM', 'Speaking, Dana Rivers Home Event, July 2026', 'Director - Dana Rivers');
    INSERT INTO appeals VALUES ('12', 'W200-WSUN', 'White Mail, Unidentified Motivation, Online Gift', 'White Mail');
  `);
  const g = (id, cid, amt, d, aid, src) => db.prepare(`INSERT INTO gifts VALUES (?,?,?,?,?,?,?${withSource ? ',?' : ''})`).run(...[id, cid, amt, d + 'T00:00:00', 'Donation', 'Active', JSON.stringify([{ appeal_id: aid, fund_id: '79' }])].concat(withSource ? [src || null] : []));
  g('1', '500', 50, '2026-09-20', '10', 'FB-SPRING');
  g('2', '500', 75, '2026-10-01', '12');
  g('3', '501', 200, '2026-09-25', '11');
  g('4', '502', 20, '2026-10-02', '12');
  db.prepare('INSERT INTO gift_custom_fields VALUES (?,?,?,?)').run('c1', '4', 'Donation Form Name', 'Chad Wells Page');
  db.prepare('INSERT INTO gift_custom_fields VALUES (?,?,?,?)').run('c2', '4', 'Donation Referral URL', 'https://www.example.org/wells?utm=x');
  return async (sql, params = []) => {
    readOnly(sql);
    return db.prepare(sql).all(...params);
  };
}

describe('appealTitle and foundLabel', () => {
  it('drop the category and the dates from an appeal description', () => {
    assert.equal(F.appealTitle('Digital Newsletter, September 2026, Week 3, Email Newsletter, Wells for Chad', 'Digital Newsletter'), 'Email Newsletter, Wells for Chad');
    assert.equal(F.appealTitle('Gift due to personal contact, Dana Rivers', 'Director - Dana Rivers'), 'Gift due to personal contact, Dana Rivers');
  });
  it("name a director's appeal by the director", () => {
    assert.equal(F.foundLabel({ appeal: 'Speaking, Dana Rivers Home Event, July 2026', category: 'Director - Dana Rivers', form: '', source: '', appealCode: 'S267-DRHM' }), 'Dana Rivers · Speaking, Dana Rivers Home Event, July 2026');
  });
});

describe('foundVia', () => {
  it('reads the first gift ever, its appeal and its website form', async () => {
    const m = await F.foundVia(world(false), ['500', '501', '502', '999']);
    assert.equal(m.size, 3);
    assert.equal(m.get('500').giftId, '1');
    assert.equal(m.get('500').label, 'Digital Newsletter · Email Newsletter, Wells for Chad');
    assert.equal(m.get('500').source, '');
    assert.equal(m.get('502').form, 'Chad Wells Page');
    assert.equal(m.get('502').referral, 'example.org/wells');
    assert.match(m.get('502').label, /Chad Wells Page$/);
  });
  it('reads a source code column once the mirror has one', async () => {
    const m = await F.foundVia(world(true), ['500']);
    assert.equal(m.get('500').source, 'FB-SPRING');
    assert.match(m.get('500').label, /Source FB-SPRING$/);
  });
});
