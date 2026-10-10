// A D1 stand-in on node:sqlite (in memory), with the calls the hub's functions use: prepare, bind, run,
// first, all and batch. Tests build their own tables with exec().
import { DatabaseSync } from 'node:sqlite';

export function memoryD1() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql) => {
    let args = [];
    const st = {
      bind: (...a) => {
        args = a;
        return st;
      },
      run: async () => {
        const r = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
      },
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    };
    return st;
  };
  return { db, exec: (sql) => db.exec(sql), prepare, batch: async (list) => Promise.all(list.map((s) => s.run())) };
}
