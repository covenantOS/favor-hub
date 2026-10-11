// Run with: npm test
//
// The mail house file and the saved-query tie lines of the two address lists: value forms, the Google Sheet in US Team Files
// (stand-in Google), and the routes' refusals. Made-up names only: the repository is public and no test reaches Google or a live database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const mf = await import('../functions/_lib/reports/mailfile.ts');
const sheet = await import('../functions/_lib/reports/mailsheet.ts');
const saved = await import('../functions/_lib/reports/saved-runs.ts');
const byId = await import('../functions/api/reports/[id].ts');

describe('the saved export forms', () => {
  it('spells the state out as the export does and leaves an unknown value as typed', () => {
    assert.equal(mf.stateName('tx'), 'Texas');
    assert.equal(mf.stateName(' DC '), 'District of Columbia');
    assert.equal(mf.stateName('ON'), 'Ontario');
    assert.equal(mf.stateName('Zz'), 'Zz');
    assert.equal(mf.stateName(null), '');
  });
  it('prints amounts without a thousands mark or trailing zeros', () => {
    assert.equal(mf.moneyText(600), '600');
    assert.equal(mf.moneyText(257.5), '257.5');
    assert.equal(mf.moneyText('1234.50'), '1234.5');
    assert.equal(mf.moneyText('x'), '');
  });
  it('prints a date as month/day/year 12:00:00 AM', () => {
    assert.equal(mf.dateText('2026-10-01'), '10/1/2026 12:00:00 AM');
    assert.equal(mf.dateText('2026-05-01T00:00:00'), '5/1/2026 12:00:00 AM');
    assert.equal(mf.dateText(null), '');
  });
  it('splits address lines into the block and the unit line as typed', () => {
    assert.deepEqual(mf.splitAddress('12 Oak St\r\nUnit 4'), { block: '12 Oak St', unit: 'Unit 4' });
    assert.deepEqual(mf.splitAddress('PO Box 9 '), { block: 'PO Box 9 ', unit: '' });
    assert.deepEqual(mf.splitAddress('1 A\nB\nC'), { block: '1 A', unit: 'B, C' });
  });
  it('writes every cell in quotes with CRLF lines and doubles a quote', () => {
    const out = mf.mailCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'x "y"', b: '' }]);
    assert.equal(out, 'A,B\r\n"x ""y""",""\r\n');
  });
});

describe('the saved-query tie', () => {
  const run = saved.SAVED_RUNS.find((r) => r.report === 'tax');
  it('matches when partners and dollars equal the saved run', () => {
    const t = mf.savedTie('tax', { year: '2025', through: '' }, run.partners, run.total);
    assert.deepEqual(t.map((x) => x.status), ['match', 'match']);
    assert.equal(t[0].against, `Saved query 1066, Annual Tax Receipts - MAIL, run ${run.ran}`);
    assert.match(t[0].note, /650 rows for 649 partners/);
  });
  it('names the difference in partners and in dollars', () => {
    const t = mf.savedTie('tax', { year: '2025', through: '' }, run.partners - 2, run.total - 10.5);
    assert.deepEqual(t.map((x) => [x.status, x.diff]), [['differs', 2], ['differs', 10.5]]);
  });
  it('draws no line when the filters are not the ones the saved query was run with', () => {
    assert.deepEqual(mf.savedTie('tax', { year: '2024', through: '' }, 1, 1), []);
    assert.deepEqual(mf.savedTie('tax', { year: '2025', through: '2025-06' }, 1, 1), []);
    assert.deepEqual(mf.savedTie('mailing', { from: '2025-01-01', to: '', min: '0.01', state: 'FL', held: '', appeal: '', kind: 'partners' }, 1, 1), []);
  });
});

/** A stand-in for Google: Drive finds the folder by name, creates the file, renames it; Sheets takes the values. */
function google({ failValues = false, folders = [{ id: 'folder-1' }] } = {}) {
  const log = [];
  const fetchFn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ url: String(url), method: init.method || 'GET', body });
    const u = String(url);
    const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes('/drive/v3/files?q=')) return ok({ files: folders });
    if (u.includes('/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink')) return ok({ id: 'sheet-1', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' });
    if (u.includes('/values/') && failValues) return new Response('{}', { status: 500 });
    if (u.includes('/drive/v3/files/sheet-1') && init.method === 'PATCH') return ok({});
    return ok({});
  };
  return { log, deps: { fetch: fetchFn, token: async () => 'tok' } };
}
const envWith = () => {
  const d1 = memoryD1();
  d1.exec('CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)');
  return { DB: d1 };
};

describe('the mail sheet in US Team Files', () => {
  it('finds the Hub mail files folder by name, makes one sheet in it, and writes every cell as text', async () => {
    const g = google();
    const made = await sheet.makeMailSheet(envWith(), 'Appeal mailing list 2026-10-11', 'Appeal mailing list', ['A', 'B'], [['1', '04101'], ['2', '=1+1']], g.deps);
    assert.equal(made.url, 'https://docs.google.com/spreadsheets/d/sheet-1/edit');
    assert.equal(made.rows, 2);
    const find = g.log[0];
    assert.match(decodeURIComponent(find.url), /name = 'Hub mail files'/);
    const create = g.log.find((l) => l.method === 'POST' && l.url.includes('webViewLink'));
    assert.deepEqual(create.body, { name: 'Appeal mailing list 2026-10-11', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['folder-1'] });
    assert.ok(g.log.every((l) => !/permissions/.test(l.url)), 'no sharing is changed');
    const put = g.log.find((l) => l.method === 'PUT');
    assert.match(put.url, /valueInputOption=RAW/);
    assert.deepEqual(put.body.values, [['A', 'B'], ['1', '04101'], ['2', '=1+1']]);
  });
  it('writes a long list in parts', async () => {
    const g = google();
    const rows = Array.from({ length: 9000 }, (_, i) => [String(i)]);
    await sheet.makeMailSheet(envWith(), 't', 'Tab', ['ID'], rows, g.deps);
    const puts = g.log.filter((l) => l.method === 'PUT');
    assert.equal(puts.length, 3);
    assert.match(decodeURIComponent(puts[1].url.split('?')[0]), /A4002$/);
  });
  it('uses the folder an admin saved before it looks by name', async () => {
    const g = google();
    const e = envWith();
    e.DB.exec("INSERT INTO hub_settings VALUES ('reports.mail_folder', 'saved-folder-id', 'a', 'b')");
    await sheet.makeMailSheet(e, 't', 'Tab', ['ID'], [], g.deps);
    assert.ok(!g.log.some((l) => l.url.includes('/drive/v3/files?q=')));
    assert.deepEqual(g.log.find((l) => l.url.includes('webViewLink')).body.parents, ['saved-folder-id']);
  });
  it('says so when the folder is missing', async () => {
    await assert.rejects(() => sheet.makeMailSheet(envWith(), 't', 'Tab', ['ID'], [], google({ folders: [] }).deps), (e) => e.status === 503 && e.code === 'no_folder');
  });
  it('renames a sheet that failed half way, because the service account cannot delete it', async () => {
    const g = google({ failValues: true });
    await assert.rejects(() => sheet.makeMailSheet(envWith(), 'Title', 'Tab', ['ID'], [['1']], g.deps), (e) => e.status === 502);
    const patch = g.log.find((l) => l.method === 'PATCH');
    assert.deepEqual(patch.body, { name: 'UNFINISHED Title' });
  });
});

describe('the mail file routes', () => {
  const e = () => {
    const d1 = memoryD1();
    d1.exec(`
      CREATE TABLE act_staff (email TEXT PRIMARY KEY, name TEXT, team TEXT, active INTEGER DEFAULT 1);
      CREATE TABLE rpt_people (email TEXT NOT NULL, audience TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (email, audience));
      INSERT INTO rpt_people VALUES ('desk@x.org', 'admin_desk', '2026-10-10');
    `);
    return { DB: d1 };
  };
  const post = (path, who, body, type = 'application/json') =>
    new Request('https://hub.test' + path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': type, 'X-Hub-Email': who, 'X-Hub-Role': 'staff', 'X-Hub-Via': 'google' } });
  const go = (request, id) => byId.onRequestPost({ request, env: e(), params: { id } });
  it('turn away no sign-in, a form post, an unknown report and a person whose role does not use the report', async () => {
    assert.equal((await byId.onRequestPost({ request: new Request('https://hub.test/api/reports/tax', { method: 'POST' }), env: e(), params: { id: 'tax' } })).status, 401);
    assert.equal((await go(post('/api/reports/tax', 'desk@x.org', {}, 'text/plain'), 'tax')).status, 415);
    assert.equal((await go(post('/api/reports/nothing', 'desk@x.org', {}), 'nothing')).status, 404);
    assert.equal((await go(post('/api/reports/mailing', 'desk@x.org', {}), 'mailing')).status, 403);
  });
  it('say a report without a mail file has none', async () => {
    const res = await go(post('/api/reports/daily-revenue', 'desk@x.org', {}), 'daily-revenue');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'no_mail_file');
  });
});
