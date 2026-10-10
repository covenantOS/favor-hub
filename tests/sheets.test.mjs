// Run with: npm test
//
// Google Sheets export (functions/_lib/hub/sheets.ts). The first group is pure: serial dates, Eastern
// times, cell values (a cell that looks like a formula stays text), column widths, the caps, chunking,
// the scope test and the request bodies. The second group runs createSheet() against a stand-in for
// Google: consent when the scope is missing, the folder, the formatted sheet, the link permission taken
// off before the sheet is called private, the same request twice making one sheet, a failure part way
// deleting the file, and the ten-in-ten-minutes limit. Made-up rows only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let S;
let google;
let d1;
let env;
const KEY = 'ab'.repeat(32);
const cols = [
  { key: 'id', label: 'Lookup ID', type: 'id' },
  { key: 'name', label: 'Partner', type: 'text' },
  { key: 'gift', label: 'Largest gift', type: 'money' },
  { key: 'when', label: 'Last gift', type: 'date' },
];
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, '0'), name: `Person ${i}`, gift: 1000 + i, when: '2026-09-30' }));
const spec = (o = {}) => ({ mode: 'rows', title: 'Lapsed major partners Ohio', tabs: [{ name: 'Partners', columns: cols, rows: rows(3) }], provenance: { kind: 'screen', page: '/brain/' }, ...o });

/** A stand-in for Google that records every call and answers like the real services do. */
function fakeGoogle({ failAt = null, shared = true, inherited = false } = {}) {
  const calls = [];
  const state = { files: new Map(), perms: [{ id: 'p1', type: 'domain', role: 'reader' }], shared };
  const fromFolder = (p) => (inherited ? { ...p, permissionDetails: [{ inherited: true, inheritedFrom: 'folder1' }] } : p);
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname + (u.search ? '?' + u.searchParams.toString() : ''), body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const step = u.pathname.includes('values:batchUpdate') ? 'values' : u.pathname.includes('permissions') ? 'share' : u.pathname.endsWith(':batchUpdate') ? (body?.requests?.[0]?.updateSpreadsheetProperties ? 'setup' : 'format') : 'other';
    if (failAt === step) return json({ error: { message: 'boom' } }, 500);
    if (u.pathname === '/drive/v3/files' && method === 'GET' && /Favor exports/.test(u.searchParams.get('q') || '')) return json({ files: state.folderExists ? [{ id: 'folder1' }] : [] });
    if (u.hostname === 'www.googleapis.com' && u.pathname === '/drive/v3/files' && method === 'POST') {
      if (body.mimeType === 'application/vnd.google-apps.folder') return json({ id: 'folder1' });
      state.files.set('sheet1', { name: body.name, parents: body.parents });
      return json({ id: 'sheet1', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet1/edit' });
    }
    if (u.pathname.startsWith('/drive/v3/files/') && u.pathname.includes('/permissions/') && method === 'DELETE') {
      // An inherited permission cannot be deleted on the file, only on the folder it came from.
      if (inherited && u.pathname.includes('/files/sheet1/')) return json({ error: { message: 'The authenticated user cannot delete the permission. If the permission is inherited...' } }, 403);
      state.perms = state.perms.filter((p) => !u.pathname.endsWith('/' + p.id));
      return new Response(null, { status: 204 });
    }
    if (u.pathname.endsWith('/permissions')) return json({ permissions: u.pathname.includes('/files/folder1/') ? [] : state.perms.map(fromFolder) });
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') {
      state.files.delete(u.pathname.split('/').pop());
      return new Response(null, { status: 204 });
    }
    if (u.pathname.startsWith('/drive/v3/files/') && u.searchParams.get('fields') === 'shared') return json({ shared: state.perms.length > 0 || state.shared === 'always' });
    if (u.pathname.startsWith('/drive/v3/files/')) return json({ id: u.pathname.split('/').pop(), trashed: false });
    if (u.hostname === 'sheets.googleapis.com') return json({});
    return json({}, 404);
  };
  return { fetch: f, calls, state };
}

async function connect(email, scopes) {
  await d1.prepare('INSERT OR REPLACE INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?,?,?,?)').bind(email, await google.seal(env, 'refresh-token'), scopes, new Date().toISOString()).run();
}

before(async () => {
  S = await import('../functions/_lib/hub/sheets.ts');
  google = await import('../functions/_lib/hub/google.ts');
});

beforeEach(() => {
  d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/google.sql', import.meta.url), 'utf8'));
  d1.exec(readFileSync(new URL('../db/sheets.sql', import.meta.url), 'utf8'));
  env = { DB: d1, GOOGLE_TOKEN_KEY: KEY, GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
  globalThis.fetch = async (url) => (String(url) === 'https://oauth.test/token' ? new Response(JSON.stringify({ access_token: 'access-1' }), { status: 200 }) : new Response('{}', { status: 404 }));
});

describe('pure helpers', () => {
  it('turns ISO dates into spreadsheet serial numbers', () => {
    assert.equal(S.dateSerial('1899-12-30'), 0);
    assert.equal(S.dateSerial('2026-10-09'), 46304);
    assert.equal(S.dateSerial('2026-10-09T23:59:00Z'), 46304, 'only the date part counts');
    assert.equal(S.dateSerial('2026-02-30'), null);
    assert.equal(S.dateSerial('soon'), null);
  });

  it('gives Eastern wall time for an instant, in summer and winter', () => {
    assert.ok(Math.abs(S.etSerial('2026-10-09T16:30:00Z') - (46304 + (12.5 / 24))) < 1e-9, 'EDT is 4 hours behind UTC');
    assert.ok(Math.abs(S.etSerial('2026-01-15T17:00:00Z') - (S.dateSerial('2026-01-15') + 12 / 24)) < 1e-9, 'EST is 5 hours behind');
    assert.equal(S.etSerial('2026-10-10T02:00:00Z') < 46305, true, 'late evening Eastern is still the day before in UTC terms');
  });

  it('writes each type the way the sheet should read it', () => {
    assert.equal(S.cellValue('=1+1', 'text'), '=1+1');
    assert.equal(S.cellValue('+15551230000', 'id'), '+15551230000');
    assert.equal(S.cellValue('00123', 'id'), '00123');
    assert.equal(S.cellValue('1250.5', 'money'), 1250.5);
    assert.equal(S.cellValue('n/a', 'int'), '');
    assert.equal(S.cellValue(12.5, 'percent'), 0.125);
    assert.equal(S.cellValue(true, 'flag'), 'Yes');
    assert.equal(S.cellValue('no', 'flag'), '');
    assert.equal(S.cellValue(null, 'text'), '');
    assert.equal(S.cellValue('x'.repeat(60000), 'text').length, 50000);
    assert.equal(S.cellValue('2026-09-30', 'date'), 46295);
  });

  it('sizes columns from the longest of the header and the first 300 rows, within 70 and 360', () => {
    const c = { key: 'n', label: 'Name', type: 'text' };
    assert.equal(S.colWidth(c, [{ n: 'a' }]), 70);
    assert.equal(S.colWidth(c, [{ n: 'x'.repeat(20) }]), 20 * 8 + 18);
    assert.equal(S.colWidth(c, [{ n: 'x'.repeat(500) }]), 360);
    assert.equal(S.colWidth({ key: 'd', label: 'Date', type: 'date' }, []), 96);
    const late = Array.from({ length: 400 }, (_, i) => ({ n: i === 350 ? 'y'.repeat(200) : 'z' }));
    assert.equal(S.colWidth(c, late), 70, 'rows past the 300th do not count');
  });

  it('cleans titles and tab names', () => {
    assert.equal(S.cleanTitle('  A\u0000 list\n of   things '), 'A list of things');
    assert.equal(S.cleanTitle('x'.repeat(300)).length, 100);
    assert.equal(S.cleanTitle(''), 'Favor list');
    const t = S.normalizeTabs([{ name: 'About this sheet', columns: cols, rows: [] }, { name: 'a/b:c', columns: cols, rows: [] }, { name: 'a b c', columns: cols, rows: [] }]);
    assert.equal(new Set(t.map((x) => x.name.toLowerCase())).size, 3);
    assert.ok(!/[\/:]/.test(t[1].name));
  });

  it('tests the Drive scope on a list in any order', () => {
    assert.equal(S.hasDriveFile('openid https://www.googleapis.com/auth/drive.file email'), true);
    assert.equal(S.hasDriveFile('https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/drive.metadata.readonly'), false);
    assert.equal(S.hasDriveFile('https://www.googleapis.com/auth/drive.file.extra'), false);
    assert.equal(S.hasDriveFile(''), false);
  });

  it('refuses tabs over the caps, with the limit in the answer', () => {
    assert.throws(() => S.normalizeTabs([{ name: 'a', columns: cols, rows: new Array(25001).fill({}) }]), (e) => e.code === 'too_big' && e.status === 413 && e.extra.limit === 25000);
    const wide = Array.from({ length: 41 }, (_, i) => ({ key: 'k' + i, label: 'K', type: 'text' }));
    assert.throws(() => S.normalizeTabs([{ name: 'a', columns: wide, rows: [] }]), (e) => e.code === 'too_big');
    assert.throws(() => S.normalizeTabs([{ name: 'a', columns: [{ key: 'x', label: 'X', type: 'nope' }], rows: [] }]), (e) => e.code === 'bad_rows');
    assert.throws(() => S.normalizeTabs([{ name: 'a', columns: [{ key: 'x', label: 'X', type: 'text' }, { key: 'x', label: 'Y', type: 'text' }], rows: [] }]), (e) => e.code === 'bad_rows', 'a repeated key');
    assert.throws(() => S.normalizeTabs([]), (e) => e.code === 'bad_rows');
    assert.throws(() => S.normalizeTabs(Array.from({ length: 5 }, (_, i) => ({ name: 't' + i, columns: cols, rows: new Array(25000).fill({}) }))), (e) => e.code === 'too_big', 'a hundred thousand rows in all');
  });

  it('splits rows into requests under the size limit and keeps every row once', () => {
    const big = Array.from({ length: 50 }, (_, i) => [i, 'x'.repeat(1000)]);
    const parts = S.chunkBySize(big, 12000);
    assert.ok(parts.length > 3);
    assert.equal(parts.flat().length, 50);
    assert.deepEqual(parts.flat().map((r) => r[0]), big.map((r) => r[0]));
    assert.deepEqual(S.chunkBySize([], 100), []);
  });

  it('builds the source line and the About rows', () => {
    const meta = { title: 't', who: 'ada@favorintl.org', name: 'Ada Example', via: 'session', provenance: { kind: 'brain', asked: 'Lapsed in Ohio', dataAsOf: '2026-10-09T10:19:00Z' }, classes: ['partner'], now: new Date('2026-10-09T21:42:00Z') };
    const tab = { name: 'P', columns: cols, rows: rows(2), more: true, note: 'A gift credited to two partners appears on two rows' };
    const line = S.sourceLine(meta, tab);
    assert.match(line, /^Source: Favor Brain, asked by Ada Example on 10\/9\/2026 5:42 PM ET\./);
    assert.match(line, /Blackbaud data as of 10\/9\/2026 6:19 AM ET\./);
    assert.match(line, /2 rows\. The list was cut at its limit\. A gift credited to two partners appears on two rows\.$/);
    const about = S.aboutRows(meta, [tab]);
    assert.ok(about.some((r) => r[0] === 'Partner information' && /inside Favor/.test(r[1])));
    assert.ok(about.some((r) => r[0] === 'Question asked' && r[1] === 'Lapsed in Ohio'));
    assert.ok(about.some((r) => r[0] === 'Sharing'));
  });

  it('makes the format requests: green header, frozen look, money and date formats, a filter', () => {
    const reqs = S.formatRequests(0, { name: 'P', columns: cols, rows: rows(10) });
    const header = reqs.find((r) => r.repeatCell && r.repeatCell.range.startRowIndex === 1 && r.repeatCell.cell.userEnteredFormat.backgroundColor);
    assert.ok(header, 'header row styled');
    assert.ok(Math.abs(header.repeatCell.cell.userEnteredFormat.backgroundColor.green - 0x4d / 255) < 1e-9);
    const money = reqs.find((r) => r.repeatCell?.cell.userEnteredFormat.numberFormat?.pattern === '$#,##0.00');
    assert.equal(money.repeatCell.range.startColumnIndex, 2);
    assert.equal(money.repeatCell.range.endRowIndex, 12);
    assert.ok(reqs.some((r) => r.repeatCell?.cell.userEnteredFormat.numberFormat?.pattern === 'yyyy-mm-dd'));
    assert.ok(reqs.some((r) => r.repeatCell?.cell.userEnteredFormat.numberFormat?.type === 'TEXT'), 'ids stay text');
    const filter = reqs.find((r) => r.setBasicFilter);
    assert.deepEqual([filter.setBasicFilter.filter.range.startRowIndex, filter.setBasicFilter.filter.range.endRowIndex], [1, 12]);
    assert.equal(reqs.filter((r) => r.updateDimensionProperties).length, 4, 'one width per column');
  });
});

describe('createSheet', () => {
  const who = { email: 'ada@favorintl.org', name: 'Ada Example', via: 'session' };
  const SCOPES = 'https://www.googleapis.com/auth/calendar.events.readonly openid https://www.googleapis.com/auth/drive.file';

  it('asks for the one-time Google step when the Drive permission is missing', async () => {
    await connect(who.email, 'https://www.googleapis.com/auth/calendar.events.readonly');
    const g = fakeGoogle();
    await assert.rejects(S.createSheet(env, who, spec(), { fetch: g.fetch }), (e) => e.code === 'consent' && e.status === 409 && /add=sheets/.test(e.extra.consentUrl));
    assert.equal(g.calls.length, 0, 'nothing reaches Google');
  });

  it('sends a person with no Google connection to connect first', async () => {
    const g = fakeGoogle();
    await assert.rejects(S.createSheet(env, who, spec(), { fetch: g.fetch }), (e) => e.code === 'not_connected' && /\/api\/google\/connect/.test(e.extra.connectUrl));
  });

  it('builds the sheet in a Favor exports folder and takes the link permission off before saying private', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle();
    const r = await S.createSheet(env, who, spec(), { fetch: g.fetch, now: () => new Date('2026-10-09T21:42:00Z') });
    assert.equal(r.ok, true);
    assert.equal(r.private, true);
    assert.equal(r.reused, false);
    assert.equal(r.title, 'Lapsed major partners Ohio 2026-10-09');
    assert.equal(r.url, 'https://docs.google.com/spreadsheets/d/sheet1/edit');
    const create = g.calls.find((c) => c.method === 'POST' && c.body?.mimeType === 'application/vnd.google-apps.spreadsheet');
    assert.deepEqual(create.body.parents, ['folder1']);
    assert.ok(g.calls.some((c) => c.method === 'DELETE' && c.path.includes('/permissions/p1')), 'the domain link permission was deleted');
    const order = g.calls.map((c) => c.path.replace(/\?.*/, ''));
    assert.ok(order.findIndex((p) => p.includes('/permissions/p1')) > order.findIndex((p) => p.endsWith('values:batchUpdate')), 'sharing is removed after the data is in');
    const values = g.calls.find((c) => c.path.includes('values:batchUpdate')).body;
    assert.equal(values.valueInputOption, 'RAW');
    assert.ok(values.data.some((d) => d.range === "'Partners'!A3" && d.values[0][0] === '00000'), 'ids keep their zeros');
    assert.ok(values.data.some((d) => d.range === "'About this sheet'!A1"));
    const row = d1.db.prepare('SELECT * FROM hub_sheets').get();
    assert.equal(row.rows, 3);
    assert.equal(row.via, 'session');
    assert.ok(!JSON.stringify(row).includes('Person 1'), 'no row values are logged');
    assert.equal(d1.db.prepare('SELECT folder_id FROM hub_sheets_folder').get().folder_id, 'folder1');
  });

  it('drops a link permission the sheet inherited by deleting it on the folder', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle({ inherited: true });
    const r = await S.createSheet(env, who, spec(), { fetch: g.fetch });
    assert.equal(r.private, true);
    assert.ok(g.calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/drive/v3/files/folder1/permissions/p1')), 'deleted on the folder');
    assert.equal(g.state.perms.length, 0);
  });

  it('uses the Favor exports folder that is already there when its record is lost', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle();
    g.state.folderExists = true;
    await S.createSheet(env, who, spec(), { fetch: g.fetch });
    assert.ok(!g.calls.some((c) => c.method === 'POST' && c.body?.mimeType === 'application/vnd.google-apps.folder'), 'no second folder');
  });

  it('fails and deletes the file when Google will not make it private', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle({ shared: 'always' });
    await assert.rejects(S.createSheet(env, who, spec(), { fetch: g.fetch }), (e) => e.code === 'google' && e.extra.step === 'share');
    assert.ok(g.calls.some((c) => c.method === 'DELETE' && c.path === '/drive/v3/files/sheet1'), 'the file was removed');
    assert.equal(g.state.files.size, 0);
    assert.deepEqual(d1.db.prepare('SELECT state FROM hub_sheets').all().map((r) => r.state), ['failed']);
  });

  it('records the row as creating when Drive makes the file, and ready when the build ends', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle();
    const seen = [];
    const inner = g.fetch;
    const fetchSpy = async (url, init) => {
      if (String(url).includes('values:batchUpdate')) seen.push(d1.db.prepare('SELECT sheet_id, state FROM hub_sheets').all());
      return inner(url, init);
    };
    const r = await S.createSheet(env, who, spec(), { fetch: fetchSpy });
    assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), [{ sheet_id: 'sheet1', state: 'creating' }], 'recorded before any data is written');
    assert.equal(d1.db.prepare('SELECT state FROM hub_sheets').get().state, 'ready');
    assert.equal(r.id, 'sheet1');
  });

  it('hands the build to waitUntil so it finishes after the client is gone', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle();
    const kept = [];
    const r = await S.createSheet(env, who, spec(), { fetch: g.fetch }, { waitUntil: (p) => kept.push(p) });
    assert.equal(kept.length, 1);
    await Promise.all(kept);
    assert.equal(r.ok, true);
    // A client that never reads the answer: the row and the finished sheet are still there.
    const g2 = fakeGoogle();
    const kept2 = [];
    const pending = S.createSheet(env, who, spec({ dedupe: 'gone' }), { fetch: g2.fetch }, { waitUntil: (p) => kept2.push(p) });
    pending.catch(() => undefined);
    while (!kept2.length) await new Promise((r) => setTimeout(r, 1));
    await Promise.all(kept2);
    const row = d1.db.prepare("SELECT state FROM hub_sheets WHERE dedupe = 'gone'").get();
    assert.equal(row.state, 'ready');
  });

  it('keeps fetch bound: a bare global fetch on an object is not used', () => {
    const src = readFileSync(new URL('../functions/_lib/hub/sheets.ts', import.meta.url), 'utf8');
    assert.ok(/d: Deps = \{ fetch: \(input, init\) => fetch\(input, init\) \}/.test(src));
    assert.ok(!/fetch: fetch[,} ]/.test(src));
  });

  it('marks the row failed and trashes the file when a step fails after the row exists', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle({ failAt: 'values' });
    await assert.rejects(S.createSheet(env, who, spec(), { fetch: g.fetch }), (e) => e.step === undefined || e.extra.step === 'values');
    assert.equal(g.state.files.size, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(d1.db.prepare('SELECT sheet_id, state FROM hub_sheets').all())), [{ sheet_id: 'sheet1', state: 'failed' }]);
  });

  it('deletes the file when a step fails part way', async () => {
    await connect(who.email, SCOPES);
    for (const step of ['setup', 'values', 'format']) {
      const g = fakeGoogle({ failAt: step });
      await assert.rejects(S.createSheet(env, who, spec({ dedupe: 'k-' + step }), { fetch: g.fetch }), (e) => e.code === 'google' && e.extra.step === step);
      assert.equal(g.state.files.size, 0, `${step}: nothing left in the Drive`);
    }
  });

  it('returns the first sheet for the same request twice, and a new one when the person deleted it', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle();
    const first = await S.createSheet(env, who, spec({ dedupe: 'brain:abc' }), { fetch: g.fetch });
    const again = await S.createSheet(env, who, spec({ dedupe: 'brain:abc' }), { fetch: g.fetch });
    assert.equal(again.reused, true);
    assert.equal(again.id, first.id);
    assert.equal(g.calls.filter((c) => c.body?.mimeType === 'application/vnd.google-apps.spreadsheet').length, 1);
    const same = await S.createSheet(env, who, spec(), { fetch: g.fetch });
    const dup = await S.createSheet(env, who, spec(), { fetch: g.fetch });
    assert.equal(dup.reused, true, 'a double click within a minute is one sheet');
    assert.equal(same.id, dup.id);
    // The person trashed it: Google says so, and a new one is made.
    const g2 = fakeGoogle();
    const orig = g2.fetch;
    g2.fetch = async (url, init) => (String(url).includes('/drive/v3/files/sheet1?fields=id,trashed') ? new Response(JSON.stringify({ id: 'sheet1', trashed: true }), { status: 200 }) : orig(url, init));
    const fresh = await S.createSheet(env, who, spec({ dedupe: 'brain:abc' }), { fetch: g2.fetch });
    assert.equal(fresh.reused, false);
  });

  it('allows ten sheets in ten minutes and no more', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle();
    for (let i = 0; i < 10; i++) await S.createSheet(env, who, spec({ dedupe: 'k' + i }), { fetch: g.fetch });
    await assert.rejects(S.createSheet(env, who, spec({ dedupe: 'k10' }), { fetch: g.fetch }), (e) => e.code === 'rate' && e.status === 429);
  });

  it('reads Brain lists through the Brain and uses its typed columns', async () => {
    await connect(who.email, SCOPES);
    const g = fakeGoogle();
    const brain = async (url, init) => {
      assert.equal(String(url), 'https://brain.test/hub/list/read');
      assert.equal(init.headers.Authorization, 'Bearer shared');
      assert.equal(init.headers['X-Acting-Email'], who.email);
      assert.deepEqual(JSON.parse(init.body).tokens, ['t123']);
      return new Response(JSON.stringify({ ok: true, lists: [{ token: 't123', title: 'Lapsed Ohio', columns: [{ key: 'lookup_id', label: 'Lookup ID', type: 'id' }, { key: 'largest_gift', label: 'Largest gift', type: 'money' }], rows: [{ lookup_id: '00042', largest_gift: 5000 }], more: false, contacts: false, reading: 'Lapsed means no gift in 12 months', dataAsOf: '2026-10-09T10:19:00Z' }] }), { status: 200 });
    };
    const r = await S.createSheet({ ...env, BRAIN_HUB_KEY: 'shared', BRAIN_URL: 'https://brain.test' }, who, { mode: 'brain', tokens: ['t123'], dedupe: 'brain:t123' }, { fetch: (u, i) => (String(u).startsWith('https://brain.test') ? brain(u, i) : g.fetch(u, i)) });
    assert.equal(r.ok, true);
    const values = g.calls.find((c) => c.path.includes('values:batchUpdate')).body;
    assert.ok(values.data.some((d) => /Favor Brain/.test(d.values[0][0] || '')), 'the source line says Favor Brain');
    assert.equal(d1.db.prepare('SELECT classes FROM hub_sheets').get().classes, 'partner');
  });

  it('turns an expired Brain list into a plain answer', async () => {
    await connect(who.email, SCOPES);
    const brain = async () => new Response(JSON.stringify({ ok: false, error: 'expired', message: 'That list expired.' }), { status: 410 });
    await assert.rejects(S.createSheet({ ...env, BRAIN_HUB_KEY: 'shared' }, who, { mode: 'brain', tokens: ['t1'] }, { fetch: brain }), (e) => e.code === 'expired' && e.status === 410);
  });

  it('lets the connector send rows only', async () => {
    await connect(who.email, SCOPES);
    await assert.rejects(S.createSheet(env, { ...who, via: 'service' }, { mode: 'brain', tokens: ['x'] }, { fetch: fakeGoogle().fetch }), (e) => e.code === 'bad_rows');
  });
});

describe('the doors', () => {
  it('the service door needs the shared key and a Favor address', async () => {
    const door = await import('../functions/api/service/sheets/create.ts');
    const post = (headers) => door.onRequestPost({ request: new Request('https://hub.test/api/service/sheets/create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(spec()) }), env: { ...env, BRAIN_HUB_KEY: 'shared' } });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: 'Bearer wrong', 'X-Acting-Email': 'ada@favorintl.org' })).status, 401);
    assert.equal((await post({ Authorization: 'Bearer shared', 'X-Acting-Email': 'ada@gmail.com' })).status, 403);
    d1.exec("CREATE TABLE IF NOT EXISTS hub_users (email TEXT PRIMARY KEY, blocked INTEGER NOT NULL DEFAULT 0); INSERT INTO hub_users (email, blocked) VALUES ('gone@favorintl.org', 1);");
    assert.equal((await post({ Authorization: 'Bearer shared', 'X-Acting-Email': 'gone@favorintl.org' })).status, 403, 'a blocked person');
    const res = await post({ Authorization: 'Bearer shared', 'X-Acting-Email': 'ada@favorintl.org' });
    assert.equal(res.status, 409, 'a person with no Google connection');
    assert.equal((await res.json()).error, 'not_connected');
  });

  it('the page door needs a signed-in person', async () => {
    const door = await import('../functions/api/sheets/create.ts');
    const res = await door.onRequestPost({ request: new Request('https://hub.test/api/sheets/create', { method: 'POST', body: '{}' }), env });
    assert.equal(res.status, 401);
  });

  it('the ping answers JSON to the key and nothing to anyone else', async () => {
    const ping = await import('../functions/api/service/ping.ts');
    const ok = await ping.onRequestGet({ request: new Request('https://hub.test/api/service/ping', { headers: { Authorization: 'Bearer shared' } }), env: { ...env, BRAIN_HUB_KEY: 'shared' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
    const no = await ping.onRequestGet({ request: new Request('https://hub.test/api/service/ping'), env: { ...env, BRAIN_HUB_KEY: 'shared' } });
    assert.equal(no.status, 401);
  });
});
