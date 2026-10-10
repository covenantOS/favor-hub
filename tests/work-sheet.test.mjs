// Run with: npm test
//
// The hub reading the RDD tracking sheet: which tabs it picks, how the rows become the text the paste reader takes, and the Google calls
// (signing in as the service account, listing tabs, reading values), against a stand-in fetch and a throwaway key. Made-up names only.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const sa = await import('../functions/_lib/work/sheetsa.ts');
const intake = await import('../functions/_lib/actions/intake.ts');

const TITLES = ["Pat's OCT Sheet", "Pat's SEPT Sheet", "Pat's AUG Sheet", "Sam's OCT Sheet ", "Sam's SEPT Sheet", 'Key', "Patty's OCT Sheet"];

describe('which tabs are read', () => {
  it('picks this month and last month for one person, whatever the spelling of September', () => {
    assert.deepEqual(sa.tabsFor(TITLES, "Pat's", [10, 9]), ["Pat's OCT Sheet", "Pat's SEPT Sheet"]);
  });
  it('matches a tab with a trailing space and does not match another person whose name starts the same way', () => {
    assert.deepEqual(sa.tabsFor(TITLES, "Sam's", [10]), ["Sam's OCT Sheet "]);
    assert.deepEqual(sa.tabsFor(TITLES, "Pat's", [10]), ["Pat's OCT Sheet"]);
  });
  it('months back wraps around the new year', () => {
    assert.deepEqual(sa.monthsBack('2026-10-10'), [10, 9]);
    assert.deepEqual(sa.monthsBack('2027-01-04'), [1, 12]);
  });
});

describe('rows become paste text', () => {
  it('joins cells with tabs, flattens line breaks, and the paste reader takes the rows', () => {
    const text = sa.valuesToText([
      ['FALSE', 'Name', 'New?', 'Date of Action', 'Phone #', 'Email', 'Address', 'Ask Value', 'Action', 'Notes: '],
      ['TRUE', 'Doe, Jane', '', '10/01/26', '', 'jane@example.org', '', '', 'VM', 'Left a message\nabout the visit'],
      ['FALSE', 'Roe, Rob', 'New', '10/02/26', '555-0100'],
    ]);
    const { rows, unread } = intake.parseSheetText(text);
    assert.equal(rows.length, 2);
    assert.equal(unread, 0);
    assert.equal(rows[0].ticked, true);
    assert.equal(rows[0].notes, 'Left a message about the visit');
    assert.equal(rows[1].isNew, 'New');
    assert.equal(rows[1].phone, '555-0100');
  });
});

function env() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { GOOGLE_SA_JSON: JSON.stringify({ client_email: 'reader@example.iam.gserviceaccount.com', private_key: pem, private_key_id: 'k1' }) };
}

function fakeGoogle() {
  const log = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    log.push({ url: u, auth: (init.headers || {}).Authorization || '', method: init.method || 'GET', body: init.body ? String(init.body) : '' });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'tok-1', expires_in: 3600 });
    if (u.includes('?fields=sheets.properties.title')) return json({ sheets: TITLES.map((title) => ({ properties: { title } })) });
    if (u.includes('/values:batchGet')) {
      const ranges = new URL(u).searchParams.getAll('ranges');
      return json({ valueRanges: ranges.map((r) => ({ values: [['FALSE', 'Name'], ['FALSE', 'Doe, Jane', '', '10/01/26', '', '', '', '', 'Call', 'Talked about ' + r.slice(0, 8)]] })) });
    }
    return json({}, 404);
  };
  return { f, log };
}

describe('reading the sheet', () => {
  const SHEET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  it('signs in as the service account with the read-only scope, lists tabs, then reads only the matching ones in one call', async () => {
    sa.forgetToken();
    const g = fakeGoogle();
    const out = await sa.readOwnerTabs(env(), SHEET, "Pat's", [10, 9], g.f);
    assert.deepEqual(out.map((t) => t.tab), ["Pat's OCT Sheet", "Pat's SEPT Sheet"]);
    assert.equal(out[0].rows, 2);
    const tokenCall = g.log.find((c) => c.url.startsWith('https://oauth2.googleapis.com/token'));
    const assertion = new URLSearchParams(tokenCall.body).get('assertion');
    const claim = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
    assert.equal(claim.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
    assert.equal(claim.iss, 'reader@example.iam.gserviceaccount.com');
    assert.equal(g.log.filter((c) => c.url.includes('values:batchGet')).length, 1);
    assert.ok(g.log.filter((c) => !c.url.startsWith('https://oauth2')).every((c) => c.auth === 'Bearer tok-1'));
    assert.ok(g.log.every((c) => c.method !== 'PUT' && c.method !== 'PATCH'), 'nothing is written to the sheet');
  });
  it('quotes a tab name that has an apostrophe', async () => {
    sa.forgetToken();
    const g = fakeGoogle();
    await sa.readOwnerTabs(env(), SHEET, "Pat's", [10], g.f);
    const read = g.log.find((c) => c.url.includes('values:batchGet'));
    assert.ok(new URL(read.url).searchParams.get('ranges').startsWith("'Pat''s OCT Sheet'!"));
  });
  it('no tabs for that person and month reads nothing', async () => {
    sa.forgetToken();
    const g = fakeGoogle();
    assert.deepEqual(await sa.readOwnerTabs(env(), SHEET, "Nobody's", [10], g.f), []);
    assert.equal(g.log.filter((c) => c.url.includes('values:batchGet')).length, 0);
  });
  it('a missing key says so in plain words, with no key text', async () => {
    sa.forgetToken();
    await assert.rejects(() => sa.readOwnerTabs({}, SHEET, "Pat's", [10], fakeGoogle().f), (e) => e.code === 'no_key' && /tracking sheet/.test(e.message));
  });
  it('a sheet id that is not an id is refused before any Google call', async () => {
    const g = fakeGoogle();
    await assert.rejects(() => sa.readOwnerTabs(env(), 'x', "Pat's", [10], g.f), (e) => e.code === 'no_sheet');
    assert.equal(g.log.length, 0);
  });
});
