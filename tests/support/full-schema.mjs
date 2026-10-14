// Every table the hub has, from db/*.sql, on an in-memory D1 stand-in. The files were written as migrations in date order, so a
// statement that needs a table from a later file is tried again after the others, until nothing more succeeds. Seed and backfill
// files are left out.
import { readdirSync, readFileSync } from 'node:fs';
import { memoryD1 } from './d1.mjs';

const DIR = new URL('../../db/', import.meta.url);
const SKIP = /seed|backfill|receipts-2026|gen_seed/;

export function fullSchemaD1() {
  const d1 = memoryD1();
  let todo = [];
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql') && !SKIP.test(f)).sort()) {
    for (const part of readFileSync(new URL(f, DIR), 'utf8').split(/;\s*(?:\r?\n|$)/)) if (part.trim()) todo.push(part + ';');
  }
  for (let pass = 0; pass < 6 && todo.length; pass++) {
    const left = [];
    for (const s of todo) {
      try {
        d1.exec(s);
      } catch {
        left.push(s);
      }
    }
    if (left.length === todo.length) break;
    todo = left;
  }
  return d1;
}
