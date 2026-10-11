// Run with: npm test
// Admin home and settings center. Every setting saves, is recorded in the audit log, and reverts. Reads keep today's behavior until
// an admin saves. Every write is admin only. Made-up addresses only.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const sql = (f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8');
let S, H, P, RR, db, env, kv;
const kvStub = () => {
  const m = new Map([['bb:ops:cap', '3000']]);
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, String(v)) };
};

before(async () => {
  db = memoryD1();
  for (const f of ['work.sql', 'expenses.sql', 'signin.sql', 'reports.sql', 'admin-home.sql']) db.exec(sql(f));
  kv = kvStub();
  env = { DB: db, BB_KV: kv, MEET_RELEASE: 'admin' };
  S = await import('../functions/_lib/admin/settings.ts');
  H = await import('../functions/_lib/admin/health.ts');
  P = await import('../functions/_lib/admin/people.ts');
  RR = await import('../functions/_lib/admin/reportRoles.ts');
});

const hdr = (email, role = 'admin', extra = {}) => ({ 'X-Hub-Email': email, 'X-Hub-Name': 'Ada', 'X-Hub-Role': role, 'X-Hub-Via': 'google', 'Content-Type': 'application/json', 'X-Hub-Request': '1', ...extra });
const call = (handler, method, path, body, headers) => handler({ request: new Request('https://hub.test' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, params: {}, waitUntil: () => {} });

describe("defaults keep today's behavior", () => {
  it('reads the values the code used before the page existed', async () => {
    const work = Object.fromEntries((await S.readArea(env, 'work')).map((v) => [v.id, v]));
    assert.equal(work['wc.release'].value, 'admins');
    assert.equal(work['wc.posting'].value, 'on');
    assert.equal(work['wc.lane_cap'].value, '2400');
    assert.equal(work['wc.upkeep_cap'].value, '3000');
    assert.equal(work['wc.thank_mode'].value, 'one');
    assert.equal(work['wc.thank_days'].value, '21');
    assert.equal(work['wc.start.director'].value, 'gifts');
    assert.equal(work['wc.start.support'].value, 'hqty');
    assert.equal(work['wc.start.partner_care'].value, 'cadence');
    assert.equal(work['wc.rollout.rdd'].value, '2026-10-12');
    assert.equal(work['wc.rollout.support'].value, '2026-10-19');
    assert.equal(work['wc.rollout.church'].value, '');
    assert.ok(Object.values(work).every((v) => v.saved === false || v.id === 'wc.upkeep_cap'));
    const meet = Object.fromEntries((await S.readArea(env, 'meetings')).map((v) => [v.id, v]));
    assert.equal(meet['meet.release'].value, 'admin');
    assert.equal(meet['meet.guests'].value, 'off');
    assert.equal(meet['meet.lead_min'].value, '15');
    assert.equal(await S.clipsCapBytes(env), 10 * 1024 ** 3);
    assert.equal(await S.mayRecordClips(env, 'pat@favorintl.org', false), true);
    assert.equal(await S.brainFlag(env, 'brain.connect_prompt'), true);
    assert.equal(await S.brainFlag(env, 'brain.auto_titles'), true);
  });

  it('a Pages variable answers until a value is saved', async () => {
    const e = { ...env, MEET_RELEASE: 'staff', MEET_GUESTS: 'on', MEET_DRIVE_FOLDER: 'folderid12345' };
    const m = await S.meetSettings(e);
    assert.deepEqual([m.release, m.guests, m.folder], ['staff', 'on', 'folderid12345']);
    const over = await S.withMeetSettings(e);
    assert.equal(over.MEET_RELEASE, 'staff');
    assert.equal(over.DB, db);
  });
});

describe('every setting saves, is audited and reverts', () => {
  const pick = (v) => {
    if (v.kind === 'enum') return v.options.find((o) => o.value !== v.value).value;
    if (v.kind === 'int') return String(Number(v.value) === v.min ? v.min + 1 : v.min);
    if (v.kind === 'date') return v.value === '2026-12-01' ? '2026-12-02' : '2026-12-01';
    return v.id === 'clips.list' ? 'pat@favorintl.org' : v.id === 'meet.drive_folder' ? 'abcdefghij1234' : 'x';
  };
  for (const area of ['work', 'meetings', 'brain', 'clips']) {
    it(`${area}: change, read back, audit row, revert`, async () => {
      for (const v of await S.readArea(env, area)) {
        const orig = v.value;
        const wasSaved = v.saved;
        const next = pick(v);
        // The upkeep cap may not drop below the lane; the lane may not rise above the cap.
        if (v.id === 'wc.upkeep_cap') continue;
        if (v.id === 'wc.lane_cap') continue;
        const saved = await S.changeSetting(env, 'will@favorintl.org', v.id, next, { confirm: true });
        assert.equal(saved.value, next, `${v.id} reads back`);
        const row = db.db.prepare('SELECT * FROM hub_audit WHERE key = ? ORDER BY id DESC LIMIT 1').get(v.id);
        assert.ok(row, `${v.id} audited`);
        assert.equal(row.actor, 'will@favorintl.org');
        assert.equal(row.before_value, orig);
        assert.equal(row.after_value, next);
        const back = saved.canReset && !wasSaved ? await S.changeSetting(env, 'will@favorintl.org', v.id, null, { reset: true }) : await S.changeSetting(env, 'will@favorintl.org', v.id, orig, { confirm: true });
        assert.equal(back.value, orig, `${v.id} reverts`);
      }
    });
  }

  it('the upkeep cap and the lane keep their gap', async () => {
    await assert.rejects(() => S.changeSetting(env, 'a', 'wc.upkeep_cap', '2000', { confirm: true }), /lane/);
    await S.changeSetting(env, 'a', 'wc.upkeep_cap', '2600', { confirm: true });
    await assert.rejects(() => S.changeSetting(env, 'a', 'wc.lane_cap', '2550', { confirm: true }), /at least 100/);
    await S.changeSetting(env, 'a', 'wc.upkeep_cap', '3000', { confirm: true });
  });

  it('a change that touches Blackbaud writes needs a confirm and names the current value', async () => {
    await assert.rejects(
      () => S.changeSetting(env, 'a', 'wc.posting', 'off'),
      (e) => e.status === 409 && e.code === 'confirm' && /on now/.test(e.message)
    );
    assert.equal((await S.readArea(env, 'work')).find((v) => v.id === 'wc.posting').value, 'on');
    for (const id of ['wc.release', 'wc.posting', 'wc.lane_cap', 'wc.upkeep_cap', 'wc.thank_mode']) assert.equal(S.defOf(id).bb, true, id);
  });

  it('refuses values outside the allowed set', async () => {
    await assert.rejects(() => S.changeSetting(env, 'a', 'clips.cap_gb', '0'), /1 to 100/);
    await assert.rejects(() => S.changeSetting(env, 'a', 'meet.release', 'everyone'), /pick one/);
    await assert.rejects(() => S.changeSetting(env, 'a', 'wc.rollout.rdd', 'soon'), /YYYY-MM-DD/);
    await assert.rejects(() => S.changeSetting(env, 'a', 'clips.list', 'a@gmail.com'), /favorintl/);
    await assert.rejects(() => S.changeSetting(env, 'a', 'nope', 'x'), /no setting/);
  });

  it('saved answers reach the code that obeys them', async () => {
    await S.changeSetting(env, 'a', 'meet.release', 'staff');
    assert.equal((await S.withMeetSettings(env)).MEET_RELEASE, 'staff');
    await S.changeSetting(env, 'a', 'meet.release', null, { reset: true });
    assert.equal((await S.withMeetSettings(env)).MEET_RELEASE, 'admin');
    await S.changeSetting(env, 'a', 'meet.lead_min', '30');
    assert.equal((await S.meetSettings(env)).leadMin, 30);
    await S.changeSetting(env, 'a', 'meet.lead_min', null, { reset: true });
    await S.changeSetting(env, 'a', 'clips.cap_gb', '4');
    assert.equal(await S.clipsCapBytes(env), 4 * 1024 ** 3);
    await S.changeSetting(env, 'a', 'clips.cap_gb', null, { reset: true });
    await S.changeSetting(env, 'a', 'clips.who', 'list');
    await S.changeSetting(env, 'a', 'clips.list', 'pat@favorintl.org');
    assert.equal(await S.mayRecordClips(env, 'pat@favorintl.org', false), true);
    assert.equal(await S.mayRecordClips(env, 'jo@favorintl.org', false), false);
    assert.equal(await S.mayRecordClips(env, 'jo@favorintl.org', true), true);
    await S.changeSetting(env, 'a', 'clips.who', null, { reset: true });
    await S.changeSetting(env, 'a', 'clips.list', null, { reset: true });
    await S.changeSetting(env, 'a', 'wc.start.director', 'open');
    const start = await import('../functions/_lib/work/start.ts');
    assert.equal((await start.getStart(env, 'pat@favorintl.org', { role: 'director' })).defaultTab, 'open');
    await S.changeSetting(env, 'a', 'wc.start.director', null, { reset: true });
    assert.equal((await start.getStart(env, 'pat@favorintl.org', { role: 'director' })).defaultTab, 'gifts');
  });

  it('the Work Center rows land where the Work Center already reads them', async () => {
    await S.changeSetting(env, 'a', 'wc.lane_cap', '2000', { confirm: true });
    assert.equal(db.db.prepare("SELECT value FROM act_settings WHERE key = 'lane_cap'").get().value, '2000');
    await S.changeSetting(env, 'a', 'wc.thank_days', '30');
    assert.equal(db.db.prepare("SELECT value FROM act_settings WHERE key = 'thank_days'").get().value, '30');
    await S.changeSetting(env, 'a', 'wc.thank_days', '21');
    await S.changeSetting(env, 'a', 'wc.rollout.church', '2026-11-02');
    assert.equal(JSON.parse(db.db.prepare("SELECT value FROM act_settings WHERE key = 'digest_rollout'").get().value).church, '2026-11-02');
    await S.changeSetting(env, 'a', 'wc.rollout.church', '');
    await S.changeSetting(env, 'a', 'wc.upkeep_cap', '2800', { confirm: true });
    assert.equal(kv.m.get('bb:ops:cap'), '2800');
    await S.changeSetting(env, 'a', 'wc.upkeep_cap', '3000', { confirm: true });
    await S.changeSetting(env, 'a', 'wc.lane_cap', '2400', { confirm: true });
    assert.equal(kv.m.get('bb:ops:cap'), '3000');
    assert.equal(db.db.prepare("SELECT value FROM act_settings WHERE key = 'lane_cap'").get().value, '2400');
  });
});

describe('admin only, on the server', () => {
  it('turns away a signed-out call, a staff member and a cross-site post', async () => {
    const mod = await import('../functions/api/admin/settings.ts');
    const no = await call(mod.onRequestGet, 'GET', '/api/admin/settings?area=work', null, {});
    assert.equal(no.status, 401);
    const staff = await call(mod.onRequestGet, 'GET', '/api/admin/settings?area=work', null, hdr('pat@favorintl.org', 'staff'));
    assert.equal(staff.status, 403);
    const staffPost = await call(mod.onRequestPost, 'POST', '/api/admin/settings', { id: 'clips.cap_gb', value: '5' }, hdr('pat@favorintl.org', 'staff'));
    assert.equal(staffPost.status, 403);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM hub_settings WHERE key LIKE 'clips.%'").get().n, 0, 'reverts leave no saved rows behind');
    const cross = await call(mod.onRequestPost, 'POST', '/api/admin/settings', { id: 'clips.cap_gb', value: '5' }, { ...hdr('will@favorintl.org'), 'X-Hub-Request': '', Origin: 'https://evil.example' });
    assert.equal(cross.status, 403);
    const ok = await call(mod.onRequestPost, 'POST', '/api/admin/settings', { id: 'clips.cap_gb', value: '5' }, hdr('will@favorintl.org'));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).setting.value, '5');
    await call(mod.onRequestPost, 'POST', '/api/admin/settings', { id: 'clips.cap_gb', reset: true }, hdr('will@favorintl.org'));
  });

  it('every admin route is wrapped in adminRoute', () => {
    const own = new Set(['login.ts', 'logout.ts', 'me.ts', 'expense-code.ts', 'expense-login.ts', 'expense-logout.ts']);
    for (const f of readdirSync(new URL('../functions/api/admin/', import.meta.url))) {
      if (own.has(f)) continue;
      const src = readFileSync(new URL('../functions/api/admin/' + f, import.meta.url), 'utf8');
      assert.match(src, /adminRoute\(/, f);
      assert.doesNotMatch(src, /PagesFunction/, f);
    }
  });
});

describe('people and roles', () => {
  it('adds a person, sets role, team, fundraiser and Work Center access, audits each field and reverts', async () => {
    const me = { email: 'will@favorintl.org', name: 'Will' };
    const p = await P.savePerson(env, me, { email: 'Pat@favorintl.org', name: 'Pat Lee', team: 'rdd', fundraiser: '1234', workCenter: true });
    assert.equal(p.email, 'pat@favorintl.org');
    assert.equal(p.team, 'rdd');
    assert.equal(p.fundraiser, '1234');
    assert.equal(p.workCenter, true);
    assert.equal(p.role, 'staff');
    const a = await P.savePerson(env, me, { email: 'pat@favorintl.org', role: 'admin' });
    assert.equal(a.role, 'admin');
    assert.equal(a.sees.admin, true);
    const rows = db.db.prepare("SELECT key, before_value, after_value FROM hub_audit WHERE key LIKE 'pat@favorintl.org:%'").all();
    assert.ok(rows.some((r) => r.key.endsWith(':role') && r.before_value === 'staff' && r.after_value === 'admin'));
    const b = await P.savePerson(env, me, { email: 'pat@favorintl.org', role: 'staff', workCenter: false, team: 'support', fundraiser: '' });
    assert.deepEqual([b.role, b.workCenter, b.team, b.fundraiser], ['staff', false, 'support', '']);
  });

  it('blocking ends sessions; nobody blocks or demotes themselves', async () => {
    const me = { email: 'will@favorintl.org', name: 'Will' };
    db.db.prepare("INSERT INTO hub_sessions (token_hash, email, created_at, expires_at, last_seen) VALUES ('t', 'jo@favorintl.org', 'x', 'y', 'z')").run();
    const j = await P.savePerson(env, me, { email: 'jo@favorintl.org', name: 'Jo', blocked: true });
    assert.equal(j.blocked, true);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM hub_sessions WHERE email = 'jo@favorintl.org'").get().n, 0);
    assert.equal(j.sees.workCenter, false);
    await P.savePerson(env, me, { email: 'jo@favorintl.org', blocked: false });
    await assert.rejects(() => P.savePerson(env, me, { email: 'will@favorintl.org', blocked: true }), /own account/);
    await assert.rejects(() => P.savePerson(env, me, { email: 'will@favorintl.org', role: 'staff' }), /own account/);
    await assert.rejects(() => P.savePerson(env, me, { email: 'x@gmail.com' }), /favorintl/);
    await assert.rejects(() => P.savePerson(env, me, { email: 'jo@favorintl.org', team: 'bogus' }), /team/);
  });

  it('who sees what follows the release and the team, and the preview matches', async () => {
    const me = { email: 'will@favorintl.org', name: 'Will' };
    await P.savePerson(env, me, { email: 'kim@favorintl.org', name: 'Kim', team: 'support', workCenter: true });
    let kim = (await P.listPeople(env)).find((x) => x.email === 'kim@favorintl.org');
    assert.equal(kim.sees.workCenter, false, 'before release only admins');
    await S.changeSetting(env, 'a', 'wc.release', 'support', { confirm: true });
    kim = (await P.listPeople(env)).find((x) => x.email === 'kim@favorintl.org');
    assert.equal(kim.sees.workCenter, true);
    const pv = await P.previewFor(env, 'kim@favorintl.org');
    assert.ok(pv.pages.some((x) => x.label === 'Work Center'));
    assert.ok(!pv.pages.some((x) => x.area === 'Admin' && x.label === 'Overview'));
    assert.ok(pv.reports.length > 0);
    await S.changeSetting(env, 'a', 'wc.release', 'admins', { confirm: true });
    assert.ok(!(await P.previewFor(env, 'kim@favorintl.org')).pages.some((x) => x.label === 'Work Center'));
    const w = await P.previewFor(env, 'will@favorintl.org');
    assert.ok(w.pages.some((x) => x.area === 'Admin'));
    await assert.rejects(() => P.previewFor(env, 'nobody@favorintl.org'), /not in the list/);
  });
});

describe('reports by role', () => {
  it('the catalog answers until a choice is saved, and a reset puts it back', async () => {
    await RR.applyReportRoles(env);
    const reg = await import('../functions/_lib/reports/registry.ts');
    const orig = [...reg.entryOf('prayer').audience];
    assert.deepEqual(orig, ['operations']);
    await S.hubPut(env, 'reports.roles.prayer', JSON.stringify(['operations', 'marketing']), 'a');
    await RR.applyReportRoles(env);
    assert.deepEqual(reg.entryOf('prayer').audience, ['operations', 'marketing']);
    await S.hubDel(env, 'reports.roles.prayer');
    await RR.applyReportRoles(env);
    assert.deepEqual(reg.entryOf('prayer').audience, orig);
  });

  it('the reports route saves, audits and resets', async () => {
    const mod = await import('../functions/api/admin/reports.ts');
    const r = await call(mod.onRequestPost, 'POST', '/api/admin/reports', { id: 'prayer', roles: ['operations', 'support'] }, hdr('will@favorintl.org'));
    const body = await r.json();
    assert.deepEqual(body.reports.find((x) => x.id === 'prayer').roles, ['operations', 'support']);
    assert.ok(db.db.prepare("SELECT 1 FROM hub_audit WHERE key = 'reports.roles.prayer' AND after_value = 'operations, support'").get());
    const back = await (await call(mod.onRequestPost, 'POST', '/api/admin/reports', { id: 'prayer', reset: true }, hdr('will@favorintl.org'))).json();
    assert.deepEqual(back.reports.find((x) => x.id === 'prayer').roles, ['operations']);
    const bad = await call(mod.onRequestPost, 'POST', '/api/admin/reports', { id: 'prayer', roles: ['wizards'] }, hdr('will@favorintl.org'));
    assert.equal(bad.status, 400);
  });
});

describe('health strip', () => {
  it('finds the weekday morning the jobs last had to run by', () => {
    const sat = Date.parse('2026-10-10T23:00:00Z');
    assert.equal(new Date(H.lastDueMorning(sat)).toISOString(), '2026-10-09T11:00:00.000Z');
    const mon = Date.parse('2026-10-12T08:00:00Z');
    assert.equal(new Date(H.lastDueMorning(mon)).toISOString(), '2026-10-09T11:00:00.000Z');
    const monLate = Date.parse('2026-10-12T12:00:00Z');
    assert.equal(new Date(H.lastDueMorning(monLate)).toISOString(), '2026-10-12T11:00:00.000Z');
  });

  it('answers all eight checks, marks a dead source as no answer, and never throws', async () => {
    const realFetch = globalThis.fetch;
    const now = Date.parse('2026-10-10T23:30:00Z');
    globalThis.fetch = async (_u, init) => {
      const q = JSON.parse(init.body).sql;
      const rows = (r) => new Response(JSON.stringify(r), { status: 200 });
      if (/__complete__/.test(q)) return rows([{ at: '2026-10-10 21:05:00' }]);
      if (/dp_docket_runs/.test(q)) return rows([{ at: '2026-10-09T09:03:27.903Z', st: 'ok' }]);
      if (/gift_phase_runs/.test(q)) return rows([{ at: '2026-10-09T10:16:14.576Z' }]);
      if (/rnc_runs/.test(q)) return rows([{ at: '2026-10-09T10:16:24.672Z' }]);
      if (/gift_phase_web_runs/.test(q)) return rows([{ at: '2026-10-09T10:18:08Z', st: 'applied', note: 'google click' }]);
      if (/iwave_status/.test(q)) return rows([{ v: JSON.stringify({ balance: 19761 }), at: '2026-10-10T23:37:49.541Z' }]);
      return rows([]);
    };
    try {
      db.db.prepare("INSERT INTO act_settings (key, value, updated_at) VALUES ('drain:called', 'ok|2026-10-10T07:45:00.000Z|nothing', 'x')").run();
      db.db.prepare("INSERT INTO hub_ai_use (day, calls) VALUES ('2026-10-10', 42)").run();
      const drive = { prepare: () => ({ bind() { return this; }, first: async () => ({ day: '2026-10-10', v: '2026-10-10T13:34:12Z' }) }) };
      const marketing = { prepare: (s) => ({ bind() { return this; }, first: async () => (/COUNT/.test(s) ? { n: 0, oldest: null } : { at: '2026-10-10 03:33:35' }) }) };
      const e = { MIRROR_API_KEY: 'k', DB: db, DRIVE_DB: drive, MARKETING_DB: marketing, BB_KV: { get: async (k) => (k.includes('count') ? '812' : k.endsWith('cap') ? '3000' : null) } };
      const items = await H.healthStrip(e, now);
      assert.deepEqual(items.map((i) => i.id), ['copy', 'morning', 'sender', 'drive', 'sky', 'iwave', 'ai', 'unsub']);
      const by = Object.fromEntries(items.map((i) => [i.id, i]));
      assert.equal(by.copy.status, 'ok');
      assert.equal(by.morning.status, 'ok');
      assert.equal(by.morning.parts.length, 4);
      assert.equal(by.sky.meter.used, 812);
      assert.equal(by.sky.meter.of, 25000);
      assert.equal(by.iwave.status, 'ok');
      assert.match(by.ai.detail, /42 calls today/);
      assert.equal(by.unsub.status, 'ok');
      assert.ok(items.every((i) => ['ok', 'late', 'failed', 'unknown'].includes(i.status)));
      // A sync that finished days ago is failed, a job that missed a morning is late or failed, and a missing binding is no answer.
      const old = await H.healthStrip({ ...e, DRIVE_DB: undefined, MARKETING_DB: undefined }, Date.parse('2026-10-14T00:00:00Z'));
      const ob = Object.fromEntries(old.map((i) => [i.id, i]));
      assert.equal(ob.copy.status, 'failed');
      assert.equal(ob.drive.status, 'unknown');
      assert.equal(ob.unsub.status, 'unknown');
      assert.ok(['late', 'failed'].includes(ob.morning.status));
      globalThis.fetch = async () => new Response('no', { status: 500 });
      const dead = await H.healthStrip(e, now);
      assert.equal(dead.find((i) => i.id === 'copy').status, 'unknown');
      assert.equal(dead.length, 8);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
