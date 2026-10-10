// A stand-in hub for the iPhone routes: an in-memory copy of the hub's own tables (D1), an in-memory copy of the Blackbaud mirror
// behind a stubbed fetch, Google's signing keys behind a stubbed JWKS address, a fake Blackbaud sender, and a fake R2 bucket.
// Requests go through the real middleware (functions/_middleware.ts) to the real route files, so the device-token path is exercised
// the way the live site runs it. Every name, id and amount is made up: the repository is public.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { memoryD1 } from './d1.mjs';
import './resolve-ts.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

export const WEB_CLIENT = 'web-client.apps.googleusercontent.com';
export const IOS_CLIENT = 'ios-client.apps.googleusercontent.com';
export const HOST = 'https://dash.favorintl.org';
export const TODAY_ET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

/* ------------------------------------------------------------------ Google's keys */

let keys;
export async function googleKeys() {
  if (keys) return keys;
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
  keys = { pair, jwk };
  return keys;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export async function idToken(claims = {}, { kid = 'test-key-1', pair } = {}) {
  const k = await googleKeys();
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://accounts.google.com', aud: IOS_CLIENT, sub: '1', email: 'ada@favorintl.org', email_verified: true, hd: 'favorintl.org', name: 'Ada Example', iat: now, exp: now + 3600, ...claims };
  const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64u(JSON.stringify(body));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (pair || k.pair).privateKey, new TextEncoder().encode(`${head}.${payload}`));
  return `${head}.${payload}.${b64u(sig)}`;
}

export const testToken = (claims = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return 'test.' + b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: IOS_CLIENT, sub: '1', email: 'ada@favorintl.org', email_verified: true, hd: 'favorintl.org', iat: now, exp: now + 3600, ...claims }));
};

/* ------------------------------------------------------------------ the mirror */

export function mirrorDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_lookup_id TEXT, constituent_type TEXT, gender TEXT, title TEXT,
      first_name TEXT, middle_name TEXT, last_name TEXT, suffix TEXT, preferred_name TEXT, organization_name TEXT, primary_address_id TEXT, primary_email_id TEXT, primary_phone_id TEXT,
      primary_online_presence_id TEXT, spouse_id TEXT, spouse_first_name TEXT, spouse_last_name TEXT, spouse_is_head_of_household INTEGER DEFAULT 0, inactive INTEGER DEFAULT 0,
      deceased INTEGER DEFAULT 0, fundraiser_status TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE gifts (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, gift_amount REAL, gift_date DATETIME, gift_type TEXT, gift_status TEXT, gift_constituency TEXT,
      gift_splits TEXT, constituent_record_id TEXT, soft_credits TEXT, fundraiser_credits TEXT, gift_payment_method TEXT, linked_gift_id TEXT, receipt_status TEXT, receipt_date DATETIME,
      receipt_amount REAL, receipt_number TEXT, acknowledgment_status TEXT, acknowledgment_date DATETIME, post_status TEXT, post_date DATETIME, gift_comments TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE actions (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, action_date_due DATETIME, action_category TEXT, action_type TEXT, action_priority_level TEXT,
      action_completed_date DATETIME, action_direction TEXT, action_summary TEXT, action_description TEXT, constituent_record_id TEXT, action_fundraiser_id TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE assignments (id TEXT PRIMARY KEY UNIQUE, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_amount REAL, assignment_appeal_id TEXT,
      assignment_campaign_id TEXT, assignment_fund_id TEXT, assignment_from_date DATETIME, assignment_to_date DATETIME, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE emails (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER DEFAULT 1, do_not_email INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE phones (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, phone_type TEXT, phone_number TEXT, is_primary INTEGER DEFAULT 1, do_not_call INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE addresses (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, address_start_date DATETIME, address_end_date DATETIME, seasonal_start TEXT,
      seasonal_end TEXT, address_type TEXT, address_lines TEXT, address_city TEXT, address_state TEXT, address_suburb TEXT, address_county TEXT, address_postal_code TEXT, address_country TEXT,
      formatted_address TEXT, is_primary INTEGER DEFAULT 1, do_not_mail INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE iwave_ratings (constituent_record_id TEXT PRIMARY KEY UNIQUE, overall INTEGER, overall_date DATETIME, affinity INTEGER, affinity_date DATETIME, rfm INTEGER, rfm_date DATETIME,
      propensity INTEGER, propensity_date DATETIME, estimated_capacity INTEGER, estimated_capacity_date DATETIME, raw_json TEXT, synced_at DATETIME, capacity_low INTEGER, capacity_high INTEGER,
      capacity_band TEXT, capacity_value INTEGER, capacity_score INTEGER, capacity_source TEXT, scored_at TEXT);
    CREATE TABLE bb_iwave_ratings (constituent_record_id TEXT PRIMARY KEY, score REAL, score_date TEXT, capacity REAL, capacity_date TEXT, ratings_json TEXT, status TEXT, detail TEXT, checked_at TEXT);
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, constituent_record_id TEXT, name TEXT, purpose TEXT, status TEXT, ask_amount REAL, ask_date TEXT, expected_amount REAL, expected_date TEXT,
      funded_amount REAL, funded_date TEXT, deadline TEXT, inactive INTEGER, fundraisers TEXT, linked_gifts TEXT, date_added TEXT, date_modified TEXT, raw_json TEXT, synced_at TEXT);
    CREATE TABLE constituent_codes (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, code_description TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY UNIQUE, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_end_date TEXT, fundraiser_active INTEGER);
    CREATE TABLE sync_log (table_name TEXT, sync_status TEXT, run_at TEXT);
    INSERT INTO constituents (id, constituent_lookup_id, constituent_type, first_name, last_name, inactive, deceased, date_added, raw_json) VALUES
      ('9001', '7001', 'Individual', 'Ada', 'Example', 0, 0, '2023-02-03T10:00:00', '{"name":"Ada Example","address":{"city":"Holland","state":"MI"}}'),
      ('9002', '7002', 'Individual', 'Ben', 'Sample', 0, 0, '2023-02-03T10:00:00', '{"name":"Ben Sample"}'),
      ('9004', '7004', 'Individual', 'Cy', 'Nobody', 0, 1, '2020-01-01T10:00:00', '{"name":"Cy Nobody"}'),
      ('9005', '7005', 'Individual', 'Dee', 'Quiet', 0, 0, '2021-01-01T10:00:00', '{"name":"Dee Quiet"}');
    INSERT INTO fundraisers VALUES ('501', 'Fay', 'Alpha', 'RDD', NULL, 1);
    INSERT INTO funds VALUES ('79', 'General Fund');
    INSERT INTO emails (id, constituent_record_id, email_address, is_primary) VALUES ('e1', '9001', 'ada@example.org', 1), ('e2', '9001', 'old@example.org', 0), ('e3', '9002', 'ben@example.org', 1);
    INSERT INTO phones (id, constituent_record_id, phone_type, phone_number, is_primary) VALUES ('p1', '9001', 'Cell Phone', '(555) 010-1234', 1);
    INSERT INTO addresses (id, constituent_record_id, address_lines, address_city, address_state, address_postal_code, address_country, is_primary) VALUES
      ('a1', '9001', '12 Maple Street', 'Holland', 'MI', '49423', 'United States', 1), ('a2', '9002', '4 Oak Road', 'Tampa', 'FL', '33601', 'United States', 1);
    INSERT INTO assignments (id, constituent_record_id, assignment_fundraiser_id, assignment_type, assignment_from_date, assignment_to_date) VALUES
      ('s1', '9001', '501', 'RDD', '2025-01-01', NULL), ('s2', '9002', '501', 'RDD', '2025-01-01', NULL), ('s3', '9005', '501', 'RDD', '2020-01-01', '2021-01-01');
    INSERT INTO sync_log VALUES ('__complete__', 'success', '2026-10-10 09:03:18');
  `);
  const year = new Date().getUTCFullYear();
  const g = db.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, constituent_record_id, gift_splits) VALUES (?,?,?,?,?,?,?)');
  const split = (id) => JSON.stringify([{ id: id + '9', amount: { value: 1 }, fund_id: '79' }]);
  g.run('g1', 100, `${year - 1}-03-01T00:00:00`, 'Donation', 'Active', '9001', split('g1'));
  g.run('g2', 250, `${year}-01-15T00:00:00`, 'Donation', 'Active', '9001', split('g2'));
  g.run('g3', 40, `${year}-02-01T00:00:00`, 'RecurringGiftPayment', 'Active', '9001', split('g3'));
  g.run('g4', 500, `${year - 1}-06-01T00:00:00`, 'Donation', 'Active', '9002', split('g4'));
  const a = db.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_category, action_type, action_summary, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?,?)');
  const raw = (id, cat, done) => JSON.stringify({ id, category: cat, completed: !!done, computed_status: done ? 'Completed' : 'Open', status: done ? 'Completed' : 'Open', fundraisers: ['501'] });
  a.run('x1', `${year}-03-01T00:00:00`, `${year}-03-02T00:00:00`, 'Phone call', 'RDD Action', 'Called', '9001', raw('x1', 'Phone call', true));
  a.run('x2', `${year}-04-01T00:00:00`, `${year}-04-02T00:00:00`, 'Meeting', 'RDD Action', 'Visited', '9001', raw('x2', 'Meeting', true));
  a.run('x3', `${year}-05-01T00:00:00`, null, 'Task/Other', 'RDD Action', 'Open task', '9001', raw('x3', 'Task/Other', false));
  a.run('x4', `${year}-02-10T00:00:00`, `${year}-02-11T00:00:00`, 'Email', 'RDD Action', 'Emailed', '9002', raw('x4', 'Email', true));
  return db;
}

/* ------------------------------------------------------------------ the world */

export const MIRROR_URL = 'https://mirror.test/d1/query';
export const JWKS_URL = 'https://jwks.test/certs';

export const bbCalls = [];
export const refreshes = [];

export function fakeR2() {
  const objects = new Map();
  return { objects, async put(key, value, opts) { objects.set(key, { value, opts }); return { key }; } };
}

/**
 * A new world: hub D1, mirror, env, and a fetch stub. `board` is what the stand-in Blackbaud repo hands the Work Center as its open actions.
 * `setup` can add staff rows or settings before the first request.
 */
export async function world({ board = [], people = {}, staff = [], settings = {} } = {}) {
  const d1 = memoryD1();
  const signin = read('db/signin.sql').split('\n').filter((l) => !l.startsWith('ALTER TABLE')).join('\n');
  d1.exec(signin);
  d1.exec('ALTER TABLE hub_users ADD COLUMN kpi INTEGER NOT NULL DEFAULT 0;');
  d1.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start TEXT NOT NULL);');
  d1.exec(read('db/work.sql'));
  d1.exec(read('db/mobile.sql'));
  const now = new Date().toISOString();
  const u = d1.db.prepare('INSERT OR IGNORE INTO hub_users (email, name, role, blocked, created_at, updated_at) VALUES (?,?,?,?,?,?)');
  u.run('will@favorintl.org', 'Will Hamilton', 'admin', 0, now, now);
  const st = d1.db.prepare('INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, active, updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const s of staff) st.run(s.email, s.name, s.team || 'rdd', s.fid ?? null, s.work_center ?? 0, s.entry_owner ?? 0, s.entry_type ?? 'RDD Action', s.active ?? 1, now);
  for (const [k, v] of Object.entries(settings)) d1.db.prepare('INSERT INTO act_settings (key, value, updated_at) VALUES (?,?,?)').run(k, v, now);

  const mirror = mirrorDb();
  const captures = fakeR2();
  const env = {
    DB: d1,
    HUB_SIGNIN: 'on',
    GOOGLE_CLIENT_ID: WEB_CLIENT,
    GOOGLE_IOS_CLIENT_ID: IOS_CLIENT,
    GOOGLE_JWKS_URL: JWKS_URL,
    MIRROR_API_KEY: 'test-key',
    MIRROR_QUERY_URL: MIRROR_URL,
    HUB_ADMINS: 'will@favorintl.org',
    MOBILE_CAPTURES: captures,
  };

  const k = await googleKeys();
  globalThis.fetch = async (url, init = {}) => {
    const u2 = String(url);
    if (u2 === JWKS_URL) return new Response(JSON.stringify({ keys: [k.jwk] }), { status: 200, headers: { 'Cache-Control': 'max-age=60' } });
    if (u2 === MIRROR_URL) {
      const { sql, params } = JSON.parse(init.body);
      if (/insert|update|replace|upsert|delete|drop|alter|create/i.test(sql)) return new Response('{"error":"read only"}', { status: 400 });
      return new Response(JSON.stringify(mirror.prepare(sql).all(...(params || []))), { status: 200 });
    }
    throw new Error('unexpected fetch ' + u2);
  };

  const route = await import('../../functions/_lib/mobile/route.ts');
  const repoRows = (ids) => ids.map((id) => mirror.prepare("SELECT id, constituent_lookup_id AS lookup, constituent_type AS ctype, first_name AS first, last_name AS last, organization_name AS org, deceased FROM constituents WHERE id = ?").get(id)).filter(Boolean);
  const hit = (r) => ({ cid: String(r.id), lookup: String(r.lookup || ''), name: `${r.first ?? ''} ${r.last ?? ''}`.trim(), place: (mirror.prepare('SELECT address_city AS c, address_state AS s FROM addresses WHERE constituent_record_id = ? AND is_primary = 1').get(r.id) ? [mirror.prepare('SELECT address_city AS c FROM addresses WHERE constituent_record_id = ? AND is_primary = 1').get(r.id).c, mirror.prepare('SELECT address_state AS s FROM addresses WHERE constituent_record_id = ? AND is_primary = 1').get(r.id).s].filter(Boolean).join(', ') : ''), holders: [], deceased: Number(r.deceased) === 1 });
  const world = {
    d1, db: d1.db, mirror, env, captures, board,
    bbCalls: [], refreshes: [], script: (c) => (c.method === 'GET' && c.path.includes('last_modified') ? { ok: true, status: 200, body: { count: 0, value: [] } } : c.method === 'POST' && c.path === '/constituent/v1/actions' ? { ok: true, status: 200, body: { id: String(7000 + world.bbCalls.length) } } : { ok: true, status: 200, body: {} }),
  };
  route.hooks.repo = () => ({
    async send(list) {
      world.bbCalls.push(...list);
      return { results: list.map((c) => world.script(c)), callsToday: 10 };
    },
    async refreshMirror(ids, tags) { world.refreshes.push({ ids, tags }); return { ok: true, runId: 'r1', maxCalls: ids.length }; },
    async synced() { return '2026-10-10T09:03:18Z'; },
    async modifiedOf() { return new Map(); },
    async loadBoard() { return { rows: world.board, people, synced: '2026-10-10T09:03:18Z', orphans: 0 }; },
    async partnersByIds(ids) { return repoRows(ids).map(hit); },
    async partners(q) {
      const like = `%${q.toLowerCase()}%`;
      return mirror.prepare("SELECT id FROM constituents WHERE lower(first_name || ' ' || last_name) LIKE ? AND COALESCE(inactive,0)=0 LIMIT 8").all(like).map((r) => hit(repoRows([r.id])[0]));
    },
    async doneActions() { return []; },
    async weekCounts() { return []; },
    async lookups() { return { byEmail: new Map(), byPhone: new Map(), byName: new Map() }; },
  });
  world.reset = () => { route.hooks.repo = undefined; };
  return world;
}

/* ------------------------------------------------------------------ calling the hub */

const routeFiles = {
  'POST /api/auth/native': '../../functions/api/auth/native.ts',
  'POST /api/auth/native/revoke': '../../functions/api/auth/native/revoke.ts',
  'POST /api/auth/native/revoke-all': '../../functions/api/auth/native/revoke-all.ts',
  'GET /api/auth/native/devices': '../../functions/api/auth/native/devices.ts',
  'GET /api/mobile/config': '../../functions/api/mobile/config.ts',
  'GET /api/mobile/today': '../../functions/api/mobile/today.ts',
  'POST /api/mobile/today/:id/done': '../../functions/api/mobile/today/[id]/done.ts',
  'GET /api/mobile/partners': '../../functions/api/mobile/partners.ts',
  'GET /api/mobile/partners/:id': '../../functions/api/mobile/partners/[id].ts',
  'POST /api/mobile/contacts': '../../functions/api/mobile/contacts.ts',
  'POST /api/mobile/captures': '../../functions/api/mobile/captures.ts',
};

function match(method, path) {
  for (const [k, file] of Object.entries(routeFiles)) {
    const [m, pattern] = k.split(' ');
    if (m !== method) continue;
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_x, n) => (names.push(n), '([^/]+)')) + '$');
    const hit = re.exec(path);
    if (hit) return { file, pattern, params: Object.fromEntries(names.map((n, i) => [n, hit[i + 1]])) };
  }
  return null;
}

/** Send one request through the real middleware to the matching route file. Returns { res, body, pattern }. */
export async function call(w, method, path, { token, body, form, headers = {}, host = HOST } = {}) {
  const mw = await import('../../functions/_middleware.ts');
  const u = new URL(path, host);
  const m = match(method, u.pathname);
  if (!m) throw new Error(`no route for ${method} ${u.pathname}`);
  const mod = await import(m.file);
  const h = new Headers(headers);
  if (token) h.set('Authorization', 'Bearer ' + token);
  let init = { method, headers: h };
  if (form) init.body = form;
  else if (body !== undefined) {
    h.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }
  const request = new Request(u, init);
  const pending = [];
  const handler = method === 'GET' ? mod.onRequestGet : mod.onRequestPost;
  const next = async (req) => handler({ request: req || request, env: w.env, params: m.params, waitUntil: (p) => pending.push(p), next: async () => new Response('x') });
  const res = await mw.onRequest({ request, env: w.env, next, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { res, status: res.status, body: parsed, pattern: m.pattern };
}

/** Sign a person in through the real route and return their device token. */
export async function signIn(w, claims = {}, deviceName = 'Staff iPhone') {
  const out = await call(w, 'POST', '/api/auth/native', { body: { id_token: await idToken(claims), device_name: deviceName } });
  if (out.status !== 200) throw new Error('sign-in failed: ' + JSON.stringify(out.body));
  return out.body.token;
}

/* ------------------------------------------------------------------ the contract */

import { parse } from 'yaml';

export const spec = parse(readFileSync(new URL('../contract/mobile-v1.yaml', import.meta.url), 'utf8'));

function deref(node) {
  while (node && node.$ref) {
    const parts = node.$ref.replace('#/', '').split('/');
    node = parts.reduce((o, k) => o[k], spec);
  }
  return node;
}

/** A small OpenAPI 3.0 schema check: type, nullable, enum, required, properties, items, additionalProperties, and the formats the contract uses. */
export function validate(schema, value, at = '$') {
  const errors = [];
  const s = deref(schema);
  if (!s) return errors;
  if (value === null) {
    if (s.nullable) return errors;
    return [`${at}: null is not allowed`];
  }
  if (s.enum && !s.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.enum)}`);
  switch (s.type) {
    case 'string':
      if (typeof value !== 'string') errors.push(`${at}: expected string, got ${typeof value}`);
      else {
        if (s.format === 'date-time' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) errors.push(`${at}: ${value} is not a date-time`);
        if (s.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) errors.push(`${at}: ${value} is not an email`);
        if (s.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) errors.push(`${at}: ${value} is not a uuid`);
      }
      break;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${at}: expected integer, got ${JSON.stringify(value)}`);
      break;
    case 'number':
      if (typeof value !== 'number') errors.push(`${at}: expected number`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${at}: expected boolean, got ${JSON.stringify(value)}`);
      break;
    case 'array':
      if (!Array.isArray(value)) errors.push(`${at}: expected array`);
      else value.forEach((v, i) => errors.push(...validate(s.items, v, `${at}[${i}]`)));
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) errors.push(`${at}: expected object`);
      else {
        for (const r of s.required || []) if (!(r in value)) errors.push(`${at}: missing required "${r}"`);
        for (const [k, sub] of Object.entries(s.properties || {})) if (k in value) errors.push(...validate(sub, value[k], `${at}.${k}`));
        if (s.additionalProperties && typeof s.additionalProperties === 'object') for (const [k, v] of Object.entries(value)) if (!(s.properties || {})[k]) errors.push(...validate(s.additionalProperties, v, `${at}.${k}`));
      }
      break;
  }
  return errors;
}

/** Every response must be a status the contract documents, with a body that matches its schema. Returns a list of problems. */
export function checkAgainstContract(method, pattern, status, body) {
  const path = pattern.replace(/:([a-z]+)/g, '{$1}');
  const op = spec.paths[path] && spec.paths[path][method.toLowerCase()];
  if (!op) return [`${method} ${path} is not in the contract`];
  const resp = deref(op.responses[String(status)]);
  if (!resp) return [`${method} ${path} answered ${status}, which the contract does not list`];
  const schema = resp.content && resp.content['application/json'] && resp.content['application/json'].schema;
  if (!schema) return status === 204 && body !== null && body !== '' ? [`${method} ${path} 204 must have no body`] : [];
  return validate(schema, body).map((e) => `${method} ${path} ${status} ${e}`);
}

export const contractLog = [];
/** Like call(), and records the pair so the contract test can check coverage. Throws on a mismatch. */
export async function callChecked(w, method, path, opts) {
  const out = await call(w, method, path, opts);
  const problems = checkAgainstContract(method, out.pattern, out.status, out.body);
  contractLog.push({ method, pattern: out.pattern, status: out.status, problems });
  if (problems.length) throw new Error(problems.join('; '));
  return out;
}
