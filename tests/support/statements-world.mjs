// A small Blackbaud copy (SQLite in memory) with invented partners and gifts, and a hub environment around it:
// the hub database with the statements tables, a storage bucket, the font and logo assets. Nothing here is a person.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { memoryD1 } from './d1.mjs';

const MIRROR = `
CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, constituent_type TEXT, first_name TEXT, middle_name TEXT, last_name TEXT, organization_name TEXT,
  spouse_first_name TEXT, spouse_last_name TEXT, primary_address_id TEXT,
  primary_addressee TEXT, primary_salutation TEXT, no_valid_address INTEGER DEFAULT 0);
CREATE TABLE addresses (id TEXT PRIMARY KEY, constituent_record_id TEXT, address_lines TEXT, address_city TEXT, address_state TEXT, address_postal_code TEXT, address_country TEXT,
  is_primary INTEGER, do_not_mail INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
CREATE TABLE emails (id TEXT PRIMARY KEY, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER DEFAULT 1, is_inactive INTEGER DEFAULT 0);
CREATE TABLE constituent_codes (id TEXT PRIMARY KEY, constituent_record_id TEXT, code_description TEXT, raw_json TEXT, is_inactive INTEGER DEFAULT 0);
CREATE TABLE solicit_codes (id TEXT PRIMARY KEY, constituent_record_id TEXT, solicit_code TEXT, solicit_end TEXT);
CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT, constituent_record_id TEXT, gift_splits TEXT, soft_credits TEXT,
  gift_payment_method TEXT, raw_json TEXT);
CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
CREATE TABLE appeals (id TEXT PRIMARY KEY, appeal_category TEXT);
`;

let n = 0;
export function mirrorWorld(year) {
  const db = new DatabaseSync(':memory:');
  db.exec(MIRROR);
  const ins = (table, row) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
  };
  ins('funds', { id: 'f1', fund_description: 'Where Needed Most' });
  ins('funds', { id: 'f2', fund_description: 'Portable Bible Schools' });
  ins('funds', { id: 'f3', fund_description: 'Non Tax Deductible: Misc Reimbursements' });
  ins('appeals', { id: 'a1', appeal_category: 'White Mail' });
  ins('appeals', { id: 'a2', appeal_category: 'Book' });

  const world = {
    db,
    year,
    sql: async (text, params = []) => db.prepare(text).all(...params),
    person(id, o = {}) {
      const lookup = o.lookup || String(100 + Number(id));
      ins('constituents', {
        id: String(id),
        constituent_lookup_id: lookup,
        constituent_type: o.org ? 'Organization' : 'Individual',
        first_name: o.first ?? null,
        last_name: o.last ?? null,
        organization_name: o.org ?? null,
        spouse_first_name: o.spouseFirst ?? null,
        spouse_last_name: o.spouseLast ?? null,
        primary_address_id: o.address === false ? null : `ad${id}`,
      });
      if (o.address !== false) {
        ins('addresses', {
          id: `ad${id}`,
          constituent_record_id: String(id),
          address_lines: o.lines ?? `${id} Example Street`,
          address_city: o.city ?? 'Anytown',
          address_state: o.state ?? 'FL',
          address_postal_code: o.zip ?? String(33000 + Number(id)),
          address_country: o.country ?? 'United States',
          is_primary: 1,
          do_not_mail: o.dnm ? 1 : 0,
        });
      }
      if (o.email) ins('emails', { id: `em${id}`, constituent_record_id: String(id), email_address: o.email });
      for (const [i, code] of (o.codes || ['Partner']).entries()) {
        ins('constituent_codes', { id: `cc${id}-${i}`, constituent_record_id: String(id), code_description: code, raw_json: JSON.stringify({ description: code }) });
      }
      return world;
    },
    gift(giver, cents, date, o = {}) {
      n += 1;
      const id = o.id || String(5000 + n);
      const dollars = cents / 100;
      const splits = o.splits || [{ amount: { value: dollars }, fund_id: o.fund || 'f1', appeal_id: o.appeal || 'a1' }];
      ins('gifts', {
        id,
        gift_amount: dollars,
        gift_date: `${date}T00:00:00`,
        gift_type: o.type || 'Donation',
        gift_status: o.status || 'Active',
        constituent_record_id: String(giver),
        gift_splits: JSON.stringify(splits),
        soft_credits: JSON.stringify(o.soft ? o.soft.map((s) => ({ constituent_id: String(s.id), amount: { value: (s.cents ?? cents) / 100 } })) : []),
        gift_payment_method: o.method || 'PersonalCheck',
        raw_json: JSON.stringify({ lookup_id: o.lookup || `G${id}`, reference: o.reference || '', is_anonymous: false }),
      });
      return world;
    },
  };
  return world;
}

/** An R2 bucket stand-in. */
export function memoryBucket() {
  const files = new Map();
  return {
    files,
    put: async (key, value) => void files.set(key, value instanceof Uint8Array ? value : new Uint8Array(value)),
    get: async (key) => (files.has(key) ? { body: files.get(key), arrayBuffer: async () => files.get(key).buffer } : null),
    delete: async (key) => void files.delete(key),
  };
}

const assets = {
  '/receipts/fonts/Arimo-Regular.ttf': 'public/receipts/fonts/Arimo-Regular.ttf',
  '/images/favor-logo-color.png': 'public/images/favor-logo-color.png',
};

export function hubEnv(extra = {}) {
  const d1 = memoryD1();
  d1.exec(readFileSync('db/statements.sql', 'utf8'));
  d1.exec(`CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE hub_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, area TEXT, key TEXT, label TEXT, before_value TEXT, after_value TEXT, note TEXT);`);
  return {
    DB: d1,
    UPLOADS: memoryBucket(),
    ASSETS: {
      fetch: async (req) => {
        const file = assets[new URL(req.url).pathname];
        return file ? new Response(readFileSync(file)) : new Response('', { status: 404 });
      },
    },
    ...extra,
  };
}

/** A request the way the middleware hands it to a function. */
export function asUser(url, user, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('X-Hub-Email', user.email);
  headers.set('X-Hub-Name', encodeURIComponent(user.name));
  headers.set('X-Hub-Role', user.role);
  headers.set('X-Hub-Via', 'google');
  return new Request(url, { ...init, headers });
}
