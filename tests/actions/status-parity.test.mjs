// The engine's isOpen and the SQL openActionSql (what the Your day card and every Work Center query use) must give the same set.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { openActionSql } from '../../functions/_lib/hub/actions.ts';
import { actionFromSlim } from '../../functions/_lib/actions/rows.ts';
import { isOpen, statusOf } from '../../functions/_lib/actions/status.ts';

const TODAY = '2026-10-09';
// Every shape the mirror holds, made up: open, past due, flag true with no date (the 1,408), flag true with a date, canceled,
// a stored status that disagrees with the flag.
const CASES = [
  { id: '1', completed: false, computed: 'Open', status: 'Open', due: '2026-10-20', date: null },
  { id: '2', completed: false, computed: 'PastDue', status: 'Past due', due: '2026-09-01', date: null },
  { id: '3', completed: true, computed: 'Completed', status: 'Completed', due: '2025-05-01', date: null },
  { id: '4', completed: true, computed: 'Completed', status: 'Completed', due: '2026-09-01', date: '2026-09-02' },
  { id: '5', completed: false, computed: 'Open', status: 'Canceled', due: '2026-09-01', date: null },
  { id: '6', completed: true, computed: 'Completed', status: 'Open', due: '2026-09-01', date: null },
  { id: '7', completed: false, computed: 'Completed', status: 'Completed', due: '2026-09-01', date: null },
  { id: '8', completed: false, computed: 'Canceled', status: 'Open', due: '2026-09-01', date: null },
];

describe('open-action parity', () => {
  it('the engine and openActionSql agree on every shape', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due TEXT, action_completed_date TEXT, raw_json TEXT)');
    const ins = db.prepare('INSERT INTO actions VALUES (?,?,?,?)');
    for (const c of CASES) {
      const raw = { completed: c.completed, computed_status: c.computed, status: c.status, fundraisers: [] };
      ins.run(c.id, `${c.due}T00:00:00`, c.date ? `${c.date}T00:00:00` : null, JSON.stringify(raw));
    }
    const sql = db.prepare(`SELECT a.id FROM actions a WHERE ${openActionSql('a')} ORDER BY a.id`).all().map((r) => r.id);
    const engine = CASES.filter((c) => {
      const rec = actionFromSlim({ id: c.id, cid: '1', due: c.due, added: null, modified: null, type: null, category: null, summary: '', description: '', completed: c.completed ? 1 : 0, completed_date: c.date, status: c.status, computed: c.computed, frs: '[]' });
      return isOpen(rec, TODAY);
    }).map((c) => c.id);
    assert.deepEqual(engine, sql, 'same set');
    assert.deepEqual(sql, ['1', '2']);
  });

  it('the completed flag decides: a flag with no date is a phantom complete, not open', () => {
    const rec = actionFromSlim({ id: '3', cid: '1', due: '2025-05-01', added: null, modified: '2025-06-01', type: null, category: null, summary: '', description: '', completed: 1, completed_date: null, status: 'Completed', computed: 'Completed', frs: '[]' });
    const s = statusOf(rec, TODAY);
    assert.equal(s.status, 'completed');
    assert.equal(s.phantomComplete, true);
  });
});
