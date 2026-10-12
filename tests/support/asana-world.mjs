// A hub database in memory for the Asana tests: the repository's own schema files, the contract's project tables, a few invented people.
import { existsSync, readFileSync } from 'node:fs';
import { memoryD1 } from './d1.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const NOW = '2026-10-11T12:00:00.000Z';
const PEOPLE = [
  ['ada@favorintl.org', 'Ada Admin', 'admin'],
  ['vic@favorintl.org', 'Vic Video', 'staff'],
  ['dan@favorintl.org', 'Dan Design', 'staff'],
];

export function world() {
  const d1 = memoryD1();
  d1.exec(read('db/schema.sql'));
  d1.exec(read('db/admin-home.sql'));
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  d1.exec(read('db/meetings.sql'));
  d1.exec(read('db/work.sql'));
  d1.exec(existsSync(new URL('../../db/projects.sql', import.meta.url)) ? read('db/projects.sql') : read('tests/fixtures/projects-contract.sql'));
  d1.exec(read('db/projects-asana.sql'));
  for (const [email, name, role] of PEOPLE) {
    d1.db.prepare('INSERT INTO hub_users (email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(email, name, role, NOW, NOW);
    d1.db.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(email, name, 'Staff', 'Marketing');
  }
  const stored = new Map();
  const uploads = {
    put: async (key, body, o) => stored.set(key, { body, type: o?.httpMetadata?.contentType }),
    get: async (key) => (stored.has(key) ? { arrayBuffer: async () => stored.get(key).body, text: async () => (typeof stored.get(key).body === 'string' ? stored.get(key).body : new TextDecoder().decode(stored.get(key).body)) } : null),
  };
  return { d1, env: { DB: d1, UPLOADS: uploads }, stored };
}

