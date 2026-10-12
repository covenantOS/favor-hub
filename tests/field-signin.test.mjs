// Run with: npm test
//
// Sign-in for field staff: Favor's own domain works as before, an allowed partner domain waits for an admin, and everyone else is refused.
// Every path through accountOf, recordSignIn, the sign-in route and the admin approval. Made-up people only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FIELD, addUser, call, cookieFor, googleSignIn, world } from './support/field-world.mjs';

const row = (w, email) => w.db.prepare('SELECT * FROM hub_users WHERE email = ?').get(email);
const staff = (over = {}) => ({ email: 'ann@favorintl.org', hd: 'favorintl.org', name: 'Ann Staff', ...over });
const setDomains = (w, v) => w.db.prepare(`INSERT OR REPLACE INTO hub_settings (key, value, updated_by, updated_at) VALUES ('signin.domains', ?, 'test', '2026-10-12')`).run(v);

describe('favorintl.org staff are unaffected', () => {
  it('sign in with a verified Workspace account and get a staff session', async () => {
    const w = await world();
    const out = await googleSignIn(w, staff());
    assert.equal(out.status, 200);
    assert.ok(out.cookie);
    assert.equal(out.data.user.role, 'staff');
    assert.equal(row(w, 'ann@favorintl.org').pending, 0);
    const me = await call(w, 'GET', '/api/auth/me', { cookie: out.cookie });
    assert.equal(me.data.user.role, 'staff');
  });

  it('keeps the old refusals: a personal Gmail, a wrong hd, a missing hd, an unverified address', async () => {
    const w = await world();
    for (const claims of [staff({ email: 'ann@gmail.com', hd: undefined }), staff({ hd: 'other.org' }), staff({ hd: undefined }), staff({ email_verified: false })]) {
      const out = await googleSignIn(w, claims);
      assert.equal(out.status, 403, JSON.stringify(claims));
      assert.equal(out.cookie, '');
    }
    assert.equal(row(w, 'ann@gmail.com'), undefined);
  });

  it('a favorintl.org person is never held for approval, even when the partner list is empty', async () => {
    const w = await world();
    setDomains(w, '');
    const out = await googleSignIn(w, staff());
    assert.equal(out.status, 200);
  });

  it('a blocked staff account is still refused', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org', blocked: 1 });
    assert.equal((await googleSignIn(w, staff())).status, 403);
  });
});

describe('an allowed partner domain waits for approval', () => {
  it('the first sign-in is held: no session, a pending row, blocked until approved', async () => {
    const w = await world();
    const out = await googleSignIn(w, FIELD());
    assert.equal(out.status, 403);
    assert.equal(out.data.error, 'pending');
    assert.equal(out.cookie, '');
    const r = row(w, 'amara@favourafrica.org');
    assert.equal(r.pending, 1);
    assert.equal(r.blocked, 1);
    assert.equal(r.role, 'field');
  });

  it('signing in again while waiting adds no second row and still gets no session', async () => {
    const w = await world();
    await googleSignIn(w, FIELD());
    const again = await googleSignIn(w, FIELD({ name: 'Amara T' }));
    assert.equal(again.status, 403);
    assert.equal(again.data.error, 'pending');
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM hub_users WHERE email = 'amara@favourafrica.org'").get().n, 1);
  });

  it('a waiting person cannot use a session cookie they never got, and a pending row opens nothing', async () => {
    const w = await world();
    await googleSignIn(w, FIELD());
    const cookie = await cookieFor(w, 'amara@favourafrica.org');
    const out = await call(w, 'GET', '/api/chat/boot', { cookie });
    assert.equal(out.status, 401, 'blocked = 1 stops the session even when a cookie exists');
  });

  it('after approval they sign in as field staff', async () => {
    const w = await world();
    await googleSignIn(w, FIELD());
    const admin = await cookieFor(w, 'will@favorintl.org');
    const ok = await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'amara@favourafrica.org', decide: 'approve' }, headers: { Origin: 'https://dash.favorintl.org' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.person.role, 'field');
    assert.equal(ok.data.person.pending, false);
    const out = await googleSignIn(w, FIELD());
    assert.equal(out.status, 200);
    assert.equal(out.data.user.role, 'field');
    assert.equal(out.data.user.kpi, false);
    const me = await call(w, 'GET', '/api/auth/me', { cookie: out.cookie });
    assert.equal(me.data.user.role, 'field');
  });

  it('a declined person stays out', async () => {
    const w = await world();
    await googleSignIn(w, FIELD());
    const admin = await cookieFor(w, 'will@favorintl.org');
    const no = await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'amara@favourafrica.org', decide: 'decline' }, headers: { Origin: 'https://dash.favorintl.org' } });
    assert.equal(no.status, 200);
    const out = await googleSignIn(w, FIELD());
    assert.equal(out.status, 403);
    assert.equal(out.data.error, 'blocked');
    assert.equal(out.cookie, '');
  });
});

describe('everyone else is refused and leaves no row', () => {
  it('refuses a domain that is not listed', async () => {
    const w = await world();
    const out = await googleSignIn(w, { email: 'bob@other.org', hd: 'other.org' });
    assert.equal(out.status, 403);
    assert.equal(out.data.error, 'wrong_domain');
    assert.equal(row(w, 'bob@other.org'), undefined);
  });

  it('refuses a listed domain without a Workspace account (hd missing) or with another hd', async () => {
    const w = await world();
    assert.equal((await googleSignIn(w, FIELD({ hd: undefined }))).status, 403);
    assert.equal((await googleSignIn(w, FIELD({ hd: 'other.org' }))).status, 403);
    assert.equal((await googleSignIn(w, FIELD({ hd: 'favorintl.org' }))).status, 403);
    assert.equal(row(w, 'amara@favourafrica.org'), undefined);
  });

  it('refuses an unverified address on a listed domain', async () => {
    const w = await world();
    assert.equal((await googleSignIn(w, FIELD({ email_verified: false }))).status, 403);
    assert.equal(row(w, 'amara@favourafrica.org'), undefined);
  });

  it('refuses look-alike domains and odd addresses', async () => {
    const w = await world();
    for (const email of ['x@favourafrica.org.evil.com', 'x@notfavourafrica.org', 'x@sub.favourafrica.org', 'a@b@favourafrica.org', '@favourafrica.org', 'favourafrica.org', 'x@favourafrica.org\u0000']) {
      const out = await googleSignIn(w, { email, hd: 'favourafrica.org' });
      assert.equal(out.status, 403, email);
    }
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM hub_users WHERE email LIKE '%favourafrica%' OR email LIKE '%evil%'").get().n, 0);
  });

  it('an empty list lets no partner domain in', async () => {
    const w = await world();
    setDomains(w, '');
    const out = await googleSignIn(w, FIELD());
    assert.equal(out.status, 403);
    assert.equal(row(w, 'amara@favourafrica.org'), undefined);
  });

  it('matches the domain without caring about case', async () => {
    const w = await world();
    setDomains(w, 'FavourAfrica.ORG');
    const out = await googleSignIn(w, FIELD({ email: 'Amara@FavourAfrica.org' }));
    assert.equal(out.data.error, 'pending');
    assert.ok(row(w, 'amara@favourafrica.org'));
  });

  it('the iPhone app sign-in stays on favorintl.org only', async () => {
    const { favorEmailOf } = await import('../functions/_lib/session.ts');
    assert.throws(() => favorEmailOf({}, { email: 'amara@favourafrica.org', email_verified: true, hd: 'favourafrica.org' }), /favorintl/);
    const src = (await import('node:fs')).readFileSync(new URL('../functions/api/auth/native.ts', import.meta.url), 'utf8');
    assert.ok(!src.includes('accountOf'));
  });
});

describe('the domain list', () => {
  it('parseDomains keeps company domains and drops everything else', async () => {
    const { parseDomains } = await import('../functions/_lib/session.ts');
    assert.deepEqual(parseDomains('favourafrica.org, Other.Org ; third.co.ke\nfavourafrica.org'), ['favourafrica.org', 'other.org', 'third.co.ke']);
    assert.deepEqual(parseDomains('gmail.com, outlook.com, yahoo.com, favorintl.org, localhost, a, -x.org, x_y.org, http://x.org'), []);
    assert.deepEqual(parseDomains(''), []);
  });

  it('an admin saves the list on the settings route and bad entries are refused with the reason', async () => {
    const w = await world();
    const admin = await cookieFor(w, 'will@favorintl.org');
    const h = { Origin: 'https://dash.favorintl.org' };
    const save = (value) => call(w, 'POST', '/api/admin/settings', { cookie: admin, body: { id: 'signin.domains', value }, headers: h });
    const ok = await save(' FavourAfrica.org,  partner.example.co.ke ');
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.setting.value, 'favourafrica.org, partner.example.co.ke');
    for (const bad of ['gmail.com', 'favorintl.org', 'not a domain', 'ok.org, gmail.com']) assert.equal((await save(bad)).status, 400, bad);
    assert.equal((await save('')).status, 200, 'an empty list is allowed and closes the door');
  });

  it('removing a domain ends the sessions of the people already approved on it', async () => {
    const w = await world();
    addUser(w, { email: 'amara@favourafrica.org', role: 'field', kpi: 0 });
    const cookie = await cookieFor(w, 'amara@favourafrica.org');
    assert.equal((await call(w, 'GET', '/api/chat/boot', { cookie })).status, 200);
    setDomains(w, 'other.org');
    assert.equal((await call(w, 'GET', '/api/chat/boot', { cookie })).status, 401);
  });

  it('only an admin may change the list or decide a request', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org', role: 'staff' });
    addUser(w, { email: 'amara@favourafrica.org', role: 'field', kpi: 0 });
    addUser(w, { email: 'bola@favourafrica.org', role: 'field', blocked: 1, pending: 1, kpi: 0 });
    const h = { Origin: 'https://dash.favorintl.org' };
    for (const email of ['ann@favorintl.org', 'amara@favourafrica.org']) {
      const cookie = await cookieFor(w, email);
      assert.equal((await call(w, 'POST', '/api/admin/settings', { cookie, body: { id: 'signin.domains', value: 'x.org' }, headers: h })).status, 403, email);
      assert.equal((await call(w, 'POST', '/api/admin/people', { cookie, body: { email: 'bola@favourafrica.org', decide: 'approve' }, headers: h })).status, email === 'ann@favorintl.org' ? 403 : 403);
    }
    assert.equal(row(w, 'bola@favourafrica.org').pending, 1);
  });
});

describe('Admin > People approval', () => {
  const h = { Origin: 'https://dash.favorintl.org' };

  it('lists a waiting person as pending, then approves them into the field-staff channel and writes the audit line', async () => {
    const w = await world();
    await googleSignIn(w, FIELD());
    const admin = await cookieFor(w, 'will@favorintl.org');
    const list = await call(w, 'GET', '/api/admin/people', { cookie: admin });
    const p = list.data.people.find((x) => x.email === 'amara@favourafrica.org');
    assert.equal(p.pending, true);
    assert.equal(p.role, 'field');
    const ok = await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'amara@favourafrica.org', decide: 'approve' }, headers: h });
    assert.equal(ok.status, 200);
    const r = row(w, 'amara@favourafrica.org');
    assert.deepEqual([r.pending, r.blocked, r.role], [0, 0, 'field']);
    const ch = w.db.prepare("SELECT id FROM chat_channels WHERE name = 'field-staff'").get();
    assert.ok(ch, 'the channel field staff start in exists');
    assert.ok(w.db.prepare('SELECT 1 FROM chat_members WHERE channel_id = ? AND email = ?').get(ch.id, 'amara@favourafrica.org'));
    const audit = w.db.prepare("SELECT * FROM hub_audit WHERE key = 'amara@favourafrica.org:access'").get();
    assert.equal(audit.after_value, 'approved');
    assert.equal(audit.actor, 'will@favorintl.org');
  });

  it('refuses to approve someone who is not waiting, a bad decision, or your own request', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org' });
    const admin = await cookieFor(w, 'will@favorintl.org');
    assert.equal((await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'ann@favorintl.org', decide: 'approve' }, headers: h })).status, 400);
    await googleSignIn(w, FIELD());
    assert.equal((await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'amara@favourafrica.org', decide: 'maybe' }, headers: h })).status, 400);
    assert.equal((await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'will@favorintl.org', decide: 'approve' }, headers: h })).status, 400);
  });

  it('adds a person on a listed domain by hand, refuses an unlisted one, and takes field staff off the list when blocked', async () => {
    const w = await world();
    const admin = await cookieFor(w, 'will@favorintl.org');
    const add = await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'kofi@favourafrica.org', name: 'Kofi Test', role: 'field' }, headers: h });
    assert.equal(add.status, 200, JSON.stringify(add.data));
    assert.equal(add.data.person.role, 'field');
    assert.equal(add.data.person.sees.workCenter, false);
    assert.equal((await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'x@other.org' }, headers: h })).status, 400);
    assert.equal((await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'kofi@favourafrica.org', role: 'owner' }, headers: h })).status, 400);
    const cookie = await cookieFor(w, 'kofi@favourafrica.org');
    assert.equal((await call(w, 'GET', '/api/chat/boot', { cookie })).status, 200);
    await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'kofi@favourafrica.org', blocked: true }, headers: h });
    assert.equal((await call(w, 'GET', '/api/chat/boot', { cookie })).status, 401);
  });

  it('a declined or waiting person never shows in the chat people list', async () => {
    const w = await world();
    await googleSignIn(w, FIELD());
    addUser(w, { email: 'kofi@favourafrica.org', role: 'field', kpi: 0 });
    const cookie = await cookieFor(w, 'kofi@favourafrica.org');
    const boot = await call(w, 'GET', '/api/chat/boot', { cookie });
    assert.ok(boot.data.users['kofi@favourafrica.org']);
    assert.equal(boot.data.users['amara@favourafrica.org'], undefined);
  });
});
