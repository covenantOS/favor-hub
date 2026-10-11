// Run with: npm test
//
// What follows a deceased mark outside Blackbaud: the hub copy re-read, the GoHighLevel contact (Do Not Disturb, tag, workflows), the giving
// portal's block, and the Work Center's reminders. Every result lands in the audit log. SQLite stands in for both databases, a script for
// GoHighLevel and the sync worker. Made-up ids, names and addresses only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const dx = await import('../functions/_lib/work/deceased.ts');

const read = (f) => readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');

function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args,
    sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      for (const s of list) db.prepare(s.sql).run(...(s.args || []));
      return [];
    },
  };
}

let hub, portal, env, ghl, log, refreshed, realFetch;
const who = { cid: '100', actor: 'Test Admin', email: 'admin@example.org' };
const emails = async () => ['ann@example.org', 'ann.old@example.net'];

function contact(extra = {}) {
  return { id: 'c1', email: 'ann@example.org', tags: ['newsletter'], dnd: false, dndSettings: {}, customFields: [], ...extra };
}

beforeEach(() => {
  const h = new DatabaseSync(':memory:');
  h.exec(read('work.sql'));
  h.exec(read('admin-home.sql'));
  h.exec(read('work-reminders.sql'));
  const p = new DatabaseSync(':memory:');
  p.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, blackbaud_constituent_id TEXT)');
  p.prepare("INSERT INTO users VALUES ('u1', 'Ann@Example.org', '100')").run();
  hub = h;
  portal = p;
  env = { DB: fakeD1(h), PORTAL_DB: fakeD1(p), GHL_PIT: 'pit-test', GHL_LOCATION: 'loc1', GHL_URL: 'https://ghl.test', MIRROR_API_KEY: 'k' };
  log = [];
  refreshed = [];
  ghl = { contacts: [contact()], workflows: [{ id: 'w1', status: 'published' }, { id: 'w2', status: 'draft' }, { id: 'w3', status: 'published' }], failTag: false };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    log.push({ method, path: u.pathname, body: init.body ? JSON.parse(init.body) : undefined });
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
    if (u.host === 'ghl.test') {
      if (u.pathname === '/contacts/' && method === 'GET') {
        const q = u.searchParams.get('query').toLowerCase();
        return json({ contacts: ghl.contacts.filter((c) => (c.email || '').toLowerCase() === q || (c.customFields || []).some((f) => String(f.value) === q)) });
      }
      if (u.pathname === '/workflows/') return json({ workflows: ghl.workflows });
      const put = u.pathname.match(/^\/contacts\/(\w+)$/);
      if (put && method === 'GET') return json({ contact: ghl.contacts.find((x) => x.id === put[1]) });
      if (put && method === 'PUT') {
        const c = ghl.contacts.find((x) => x.id === put[1]);
        const b = JSON.parse(init.body);
        c.dnd = b.dnd;
        c.dndSettings = b.dndSettings;
        return json({ contact: c });
      }
      const tags = u.pathname.match(/^\/contacts\/(\w+)\/tags$/);
      if (tags) {
        if (ghl.failTag) return json({}, 500);
        const c = ghl.contacts.find((x) => x.id === tags[1]);
        const b = JSON.parse(init.body);
        c.tags = method === 'POST' ? [...new Set([...c.tags, ...b.tags])] : c.tags.filter((t) => !b.tags.includes(t));
        return json({ tags: c.tags });
      }
      if (/^\/contacts\/\w+\/workflow\/\w+$/.test(u.pathname) && method === 'DELETE') return json({ succeded: true });
    }
    return json({}, 404);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const deps = () => ({
  emails,
  refresh: async (_e, ids) => {
    refreshed.push(ids);
    return { ok: true, runId: 'r', maxCalls: 6 };
  },
});
const audit = () => hub.prepare("SELECT label, note FROM hub_audit WHERE area = 'records' ORDER BY id").all();

describe('deceased effects', () => {
  it('blocks every channel, tags, leaves workflows, blocks the portal, closes reminders, and logs each effect', async () => {
    hub.prepare("INSERT INTO act_reminders (id, owner, kind, cid, title, due_at, state, created_at) VALUES ('r1', 'a@example.org', 'partner', '100', 'Call Ann', '2026-10-12T12:00:00Z', 'open', '2026-10-10T00:00:00Z'), ('r2', 'a@example.org', 'partner', '200', 'Call Bob', '2026-10-12T12:00:00Z', 'open', '2026-10-10T00:00:00Z')").run();
    const out = await dx.runDeceasedEffects(env, { ...who, on: true }, deps());
    assert.deepEqual(out.map((e) => [e.effect, e.ok]), [['mirror', true], ['ghl', true], ['portal', true], ['workcenter', true]]);
    assert.deepEqual(refreshed, [['100']]);
    const c = ghl.contacts[0];
    assert.equal(c.dnd, true);
    for (const ch of dx.CHANNELS) assert.equal(c.dndSettings[ch].status, 'active');
    assert.ok(c.tags.includes('deceased') && c.tags.includes('newsletter'));
    const removals = log.filter((l) => l.method === 'DELETE').map((l) => l.path);
    assert.deepEqual(removals, ['/contacts/c1/workflow/w1', '/contacts/c1/workflow/w3']);
    const blocks = portal.prepare('SELECT kind, value, reason FROM portal_blocks ORDER BY kind, value').all();
    assert.deepEqual(blocks.map((b) => `${b.kind}:${b.value}`), ['constituent:100', 'email:ann.old@example.net', 'email:ann@example.org']);
    assert.equal(hub.prepare("SELECT state FROM act_reminders WHERE id = 'r1'").get().state, 'done');
    assert.equal(hub.prepare("SELECT state FROM act_reminders WHERE id = 'r2'").get().state, 'open');
    const rows = audit();
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.label.startsWith('Marked deceased')));
    assert.match(rows.find((r) => r.label.includes('Giving portal')).note, /1 portal account found/);
    assert.equal(hub.prepare("SELECT COUNT(*) AS n FROM act_events WHERE kind = 'deceased_effect'").get().n, 4);
  });

  it('leaves a channel the person already blocked alone, and unmarking releases only what the hub set', async () => {
    ghl.contacts[0].dnd = true;
    ghl.contacts[0].dndSettings = { Email: { status: 'active', message: 'Unsubscribed', code: 'unsub' } };
    await dx.runDeceasedEffects(env, { ...who, on: true }, deps());
    assert.equal(ghl.contacts[0].dndSettings.Email.code, 'unsub');
    assert.equal(ghl.contacts[0].dndSettings.SMS.code, 'hub-deceased');
    const out = await dx.runDeceasedEffects(env, { ...who, on: false }, deps());
    assert.ok(out.every((e) => e.ok));
    const c = ghl.contacts[0];
    assert.equal(c.dndSettings.Email.status, 'active');
    assert.equal(c.dndSettings.SMS.status, 'inactive');
    assert.equal(c.dnd, true, 'the unsubscribe still holds');
    assert.ok(!c.tags.includes('deceased'));
    assert.equal(portal.prepare('SELECT COUNT(*) AS n FROM portal_blocks').get().n, 0);
  });

  it('unmarking a contact the hub fully blocked turns Do Not Disturb off', async () => {
    await dx.runDeceasedEffects(env, { ...who, on: true }, deps());
    await dx.runDeceasedEffects(env, { ...who, on: false }, deps());
    const c = ghl.contacts[0];
    assert.equal(c.dnd, false);
    assert.ok(dx.CHANNELS.every((ch) => c.dndSettings[ch].status === 'inactive'));
  });

  it('finds a contact by the Blackbaud id in a custom field when no email matches', async () => {
    ghl.contacts = [contact({ id: 'c9', email: 'other@example.org', customFields: [{ value: '100' }] })];
    const out = await dx.runDeceasedEffects(env, { ...who, on: true }, deps());
    assert.equal(out[1].ok, true);
    assert.ok(ghl.contacts[0].tags.includes('deceased'));
  });

  it('reports no match without failing, and a failed step does not stop the others', async () => {
    ghl.contacts = [];
    let out = await dx.runDeceasedEffects(env, { ...who, on: true }, deps());
    assert.match(out[1].detail, /No GoHighLevel contact matches/);
    ghl.contacts = [contact()];
    ghl.failTag = true;
    out = await dx.runDeceasedEffects(env, { ...who, on: true }, deps());
    assert.equal(out[1].ok, false);
    assert.equal(out[2].ok, true, 'the portal block still went in');
    assert.ok(audit().some((r) => /FAILED/.test(r.note)));
    assert.equal(hub.prepare("SELECT COUNT(*) AS n FROM act_events WHERE kind = 'deceased_effect_failed'").get().n, 1);
  });

  it('says so when GoHighLevel or the portal is not connected', async () => {
    const bare = { DB: env.DB, MIRROR_API_KEY: 'k' };
    const out = await dx.runDeceasedEffects(bare, { ...who, on: true }, deps());
    assert.equal(out[1].ok, false);
    assert.match(out[1].detail, /not connected/);
    assert.equal(out[2].ok, false);
    assert.match(out[2].detail, /not connected/);
  });

  it('a record change that is not a deceased mark refreshes the hub copy and runs no effects', async () => {
    const payload = JSON.stringify({ __call: { method: 'PATCH', path: '/constituent/v1/phones/10' }, do_not_call: true });
    hub.prepare("INSERT INTO act_outbox (id, batch_id, cid, op, payload, state, queued_at) VALUES ('o1', 'b1', '100', 'call', ?, 'sent', '2026-10-11T00:00:00Z')").run(payload);
    const rows = hub.prepare('SELECT id, batch_id, op, cid, payload FROM act_outbox').all();
    const out = await dx.afterRecordRows(env, { actor: 'a', email: 'a@example.org' }, rows, deps());
    assert.deepEqual(out, { refreshed: ['100'], deceased: [] });
    assert.deepEqual(refreshed, [['100']]);
    assert.equal(log.length, 0);
    assert.equal(audit().length, 0);
  });

  it('a deceased PATCH that passed its read-back runs the effects once, and a failed one runs nothing', async () => {
    const payload = (d) => JSON.stringify({ __call: { method: 'PATCH', path: '/constituent/v1/constituents/100' }, deceased: d });
    hub.prepare("INSERT INTO act_outbox (id, batch_id, cid, op, payload, state, queued_at) VALUES ('o1', 'b1', '100', 'call', ?, 'verified', '2026-10-11T00:00:00Z'), ('o2', 'b2', '100', 'call', ?, 'failed', '2026-10-11T00:00:00Z')").run(payload(true), payload(false));
    const rows = hub.prepare('SELECT id, batch_id, op, cid, payload FROM act_outbox ORDER BY id').all();
    const out = await dx.afterRecordRows(env, { actor: 'a', email: 'a@example.org' }, rows, deps());
    assert.deepEqual(out.deceased, [{ cid: '100', on: true }]);
    assert.equal(audit().length, 4);
  });
});
