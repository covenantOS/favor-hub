// Run with: npm test
//
// Giving statements. The inclusion rules one by one on invented gifts, the wording, the PDF, the reads against an
// in-memory copy of the Blackbaud tables, the year-end run (files of a set size, one open file at a time, no partner
// twice, discard, the tie-outs), the email switch that stays off, and who may open the routes.
// Every name and figure is made up: the repository is public.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import './support/resolve-ts.mjs';
import { asUser, hubEnv, mirrorWorld } from './support/statements-world.mjs';

const rules = await import('../functions/_lib/statements/rules.ts');
const copyMod = await import('../functions/_lib/statements/copy.ts');
const data = await import('../functions/_lib/statements/data.ts');
const pdfMod = await import('../functions/_lib/statements/pdf.ts');
const store = await import('../functions/_lib/statements/store.ts');
const svc = await import('../functions/_lib/statements/service.ts');
const sample = await import('../functions/_lib/statements/sample.ts');
const settings = await import('../functions/_lib/admin/settings.ts');
const me = await import('../functions/api/statements/me.ts');
const yearend = await import('../functions/api/statements/yearend.ts');

const YEAR = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date())) - 1;
const Y = String(YEAR);
const WHO = { email: 'desk@example.org', name: 'Desk Person' };

/* ------------------------------------------------------------------ the rules */

const NAMES = {
  fund: (id) => ({ f1: 'Where Needed Most', f2: 'Portable Bible Schools', f3: 'Non Tax Deductible: Misc Reimbursements' })[id] || '',
  appealCategory: (id) => ({ a1: 'White Mail', a2: 'Book' })[id] || '',
};
const P = { id: '1', lookup: '101', name: 'Ann Lee', addressee: 'Ann Lee', sortName: 'lee ann', organization: false, addressLines: ['1 Main St'], city: 'Town', state: 'FL', zip: '33000', country: 'United States', email: '', constituency: ['Partner'] };
const g = (id, cents, over = {}) => ({
  id, lookup: id, giverId: '1', giverName: 'Ann Lee', date: `${Y}-03-01`, cents, type: 'Donation', status: 'Active', method: 'PersonalCheck', reference: '', anonymous: false,
  splits: [{ cents, fundId: 'f1', appealId: 'a1' }], soft: [], ...over,
});
const stmt = (gifts, o = { includeSoft: true }) => rules.composeStatement(P, gifts, `${Y}-01-01`, `${Y}-12-31`, NAMES, o);

describe('what belongs on a statement', () => {
  it('lists one-time gifts and monthly payments the partner gave, in date order', () => {
    const s = stmt([g('b', 5000, { date: `${Y}-05-01`, type: 'RecurringGiftPayment' }), g('a', 20000)]);
    assert.deepEqual(s.gifts.map((l) => [l.giftId, l.kind]), [['a', 'One-time'], ['b', 'Monthly']]);
    assert.equal(s.totals.gifts, 25000);
    assert.equal(s.totals.giftCount, 2);
    assert.equal(s.totals.net, 25000);
  });
  it('leaves off a recurring gift setup, which is a schedule and not money', () => {
    const s = stmt([g('s', 5000, { type: 'RecurringGift' }), g('a', 1000)]);
    assert.equal(s.gifts.length, 1);
    assert.deepEqual(s.left.map((l) => l.reason), ['schedule']);
    assert.equal(s.totals.taxBasis, 1000);
  });
  it('leaves off a $0 declined payment', () => {
    const s = stmt([g('z', 0, { type: 'RecurringGiftPayment', reference: 'HARDREJECT: Invalid account number.' })]);
    assert.equal(s.gifts.length, 0);
    assert.deepEqual(s.left.map((l) => l.reason), ['zero']);
  });
  it('leaves off a declined card recorded with an amount and says a person has to settle it', () => {
    const s = stmt([g('d', 5000, { reference: 'HardReject: Stolen or lost card.' }), g('a', 1000)]);
    assert.deepEqual(s.left.map((l) => l.reason), ['declined']);
    assert.equal(s.totals.gifts, 1000);
    assert.equal(s.totals.taxBasis, 6000, 'the tax lists still add the amount, so the difference is visible');
    assert.ok(s.notes.some((n) => /declined card/.test(n)));
  });
  it('shows a refund on its own line and takes it off the net total', () => {
    const s = stmt([g('a', 10000), g('r', -2500)]);
    assert.equal(s.refunds.length, 1);
    assert.equal(s.totals.refunds, -2500);
    assert.equal(s.totals.net, 7500);
    assert.equal(s.totals.gifts, 10000);
    assert.equal(s.totals.taxBasis, 10000);
  });
  it('lists a gift to a Non Tax Deductible fund apart and does not count it', () => {
    const s = stmt([g('a', 10000), g('n', 3000, { splits: [{ cents: 3000, fundId: 'f3', appealId: 'a1' }] })]);
    assert.equal(s.totals.gifts, 10000);
    assert.equal(s.totals.notDeductible, 3000);
    assert.equal(s.notDeductible[0].giftId, 'n');
    assert.equal(s.totals.taxBasis, 13000);
  });
  it('lists a book purchase apart: goods were provided', () => {
    const s = stmt([g('k', 5000, { splits: [{ cents: 5000, fundId: 'f1', appealId: 'a2' }] })]);
    assert.equal(s.totals.gifts, 0);
    assert.equal(s.totals.notDeductible, 5000);
  });
  it('splits a gift that goes partly to a non-deductible fund into two lines that add to the gift', () => {
    const s = stmt([g('m', 10000, { splits: [{ cents: 7000, fundId: 'f1', appealId: 'a1' }, { cents: 3000, fundId: 'f3', appealId: 'a1' }] })]);
    assert.equal(s.totals.gifts, 7000);
    assert.equal(s.totals.notDeductible, 3000);
    assert.equal(s.totals.giftCount, 1);
    assert.ok(s.gifts[0].flags.includes('split') && s.notDeductible[0].flags.includes('split'));
  });
  it('marks a stock or in-kind gift, counts it, and prints the note', () => {
    const s = stmt([g('s', 400000, { reference: 'Stock Gift' }), g('v', 20000, { reference: 'In-kind vehicle donation' })]);
    assert.equal(s.totals.gifts, 420000);
    assert.ok(s.gifts.every((l) => l.flags.includes('noncash')));
    assert.ok(s.notes.some((n) => /stock or in-kind/i.test(n)));
  });
  it('treats a fund that passed the money along as the donor: the soft-credited partner sees it in its own section', () => {
    const fund = g('f', 100000, { giverId: '900', giverName: 'Sample Giving Fund', soft: [{ id: '1', cents: 100000 }] });
    const mine = stmt([fund, g('a', 1000)]);
    assert.equal(mine.soft.length, 1);
    assert.equal(mine.soft[0].from, 'Sample Giving Fund');
    assert.equal(mine.totals.soft, 100000);
    assert.equal(mine.totals.gifts, 1000, 'never in the tax total');
    assert.equal(mine.totals.taxBasis, 1000);
    // The fund's own statement lists the gift as its own.
    const theirs = rules.composeStatement({ ...P, id: '900', lookup: '900' }, [fund], `${Y}-01-01`, `${Y}-12-31`, NAMES, { includeSoft: true });
    assert.equal(theirs.totals.gifts, 100000);
    assert.equal(theirs.soft.length, 0);
  });
  it('hides the through-a-fund section when asked and says how many were hidden', () => {
    const fund = g('f', 100000, { giverId: '900', soft: [{ id: '1', cents: 100000 }] });
    const s = stmt([fund], { includeSoft: false });
    assert.equal(s.soft.length, 0);
    assert.deepEqual(s.left.map((l) => l.reason), ['soft_hidden']);
    assert.ok(s.notes.some((n) => /soft-credited/.test(n)));
  });
  it('keeps a gift the partner gave on the partner even when someone else is soft-credited', () => {
    const s = stmt([g('a', 5000, { soft: [{ id: '77', cents: 5000 }] })]);
    assert.equal(s.totals.gifts, 5000);
  });
  it('leaves off a gift whose status is not Active or Completed', () => {
    const s = stmt([g('x', 5000, { status: 'Terminated' }), g('c', 1000, { status: 'Completed' })]);
    assert.equal(s.totals.gifts, 1000);
    assert.deepEqual(s.left.map((l) => l.reason), ['status']);
  });
  it('keeps only gifts inside the dates, ends included, and counts each gift once', () => {
    const s = rules.composeStatement(P, [g('a', 1000, { date: `${Y}-03-01` }), g('b', 2000, { date: `${Y}-03-31` }), g('c', 4000, { date: `${Y}-04-01` }), g('a', 1000, { date: `${Y}-03-01` })], `${Y}-03-01`, `${Y}-03-31`, NAMES, { includeSoft: true });
    assert.equal(s.totals.gifts, 3000);
    assert.equal(s.totals.giftCount, 2);
  });
  it('adds in cents so the lines add up to the total on the page', () => {
    const s = stmt([g('a', 1010), g('b', 2020), g('c', 3030)]);
    assert.equal(s.totals.gifts, s.gifts.reduce((t, l) => t + l.cents, 0));
    assert.equal(rules.moneyOf(s.totals.gifts), '$60.60');
    assert.equal(rules.moneyOf(-2500), '-$25.00');
  });
  it('totals the designations', () => {
    const s = stmt([g('a', 1000), g('b', 5000, { splits: [{ cents: 5000, fundId: 'f2', appealId: 'a1' }] }), g('c', 2000)]);
    assert.deepEqual(s.byFund, [{ fund: 'Portable Bible Schools', cents: 5000 }, { fund: 'Where Needed Most', cents: 3000 }]);
  });
  it('reads a year or two dates and refuses a bad range in plain words', () => {
    assert.deepEqual(rules.rangeOf('2025', '', ''), { from: '2025-01-01', to: '2025-12-31' });
    assert.deepEqual(rules.rangeOf('', '2026-03-01', '2026-06-30'), { from: '2026-03-01', to: '2026-06-30' });
    assert.throws(() => rules.rangeOf('', '2026-06-30', '2026-03-01'), /before/);
    assert.throws(() => rules.rangeOf('', '2026-02-30', '2026-03-01'), /YYYY-MM-DD/);
    assert.throws(() => rules.rangeOf('abc', '', ''), /year/);
    assert.equal(rules.periodLabel('2025-01-01', '2025-12-31'), '2025');
    assert.equal(rules.periodLabel('2026-03-01', '2026-06-30'), 'March 1, 2026 to June 30, 2026');
  });
});

/* ------------------------------------------------------------------- wording */

describe('the wording', () => {
  it('starts from the portal statement: EIN, tax-exempt status and no goods or services', () => {
    assert.match(copyMod.DEFAULT_COPY.goods, /No goods or services/);
    assert.match(copyMod.DEFAULT_COPY.tax, /47-5225697/);
    assert.match(copyMod.DEFAULT_COPY.footer, /3433 Lithia Pinecrest Rd #356, Valrico, FL 33596/);
  });
  it('keeps no em dash anywhere in the default words', () => {
    for (const v of Object.values(copyMod.DEFAULT_COPY)) assert.ok(!v.includes('—'), v);
  });
  it('falls back to the default for a blank or missing line, but lets the title under the name be blank', () => {
    const c = copyMod.cleanCopy({ goods: '   ', intro: 'Hello {period}.', signerTitle: '' });
    assert.equal(c.goods, copyMod.DEFAULT_COPY.goods);
    assert.equal(c.intro, 'Hello {period}.');
    assert.equal(c.signerTitle, '');
  });
  it('cuts a line at its limit and fills the marks', () => {
    const c = copyMod.cleanCopy({ closing: 'x'.repeat(500) });
    assert.equal(c.closing.length, 60);
    assert.equal(copyMod.fill('For {period}, {year}.', { period: '2025', year: '2025' }), 'For 2025, 2025.');
    assert.equal(copyMod.fill('Keep {unknown}.', {}), 'Keep {unknown}.');
  });
});

/* --------------------------------------------------------------------- the PDF */

async function assetsFor(env) {
  return svc.pdfAssets(env);
}

describe('the PDF', () => {
  it('prints a sample statement with every section on Favor letterhead layout', async () => {
    const env = hubEnv();
    const bytes = await pdfMod.buildPdf({ statements: [sample.sampleStatement(YEAR)], copy: copyMod.DEFAULT_COPY, yearEnd: true, issued: `${YEAR + 1}-01-20`, ...(await assetsFor(env)) });
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 1);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    assert.deepEqual([w, h], [612, 792], 'letter size');
  });
  it('runs a long list onto more pages without losing a gift, and one file holds many statements', async () => {
    const env = hubEnv();
    const many = Array.from({ length: 90 }, (_, i) => g(`m${i}`, 1000 + i, { date: `${Y}-${String((i % 12) + 1).padStart(2, '0')}-10` }));
    const long = stmt(many);
    const short = stmt([g('a', 1000)]);
    const one = await pdfMod.buildPdf({ statements: [long], copy: copyMod.DEFAULT_COPY, yearEnd: true, issued: `${YEAR + 1}-01-20`, ...(await assetsFor(env)) });
    const two = await pdfMod.buildPdf({ statements: [long, short], copy: copyMod.DEFAULT_COPY, yearEnd: true, issued: `${YEAR + 1}-01-20`, ...(await assetsFor(env)) });
    const a = (await PDFDocument.load(one)).getPageCount();
    const b = (await PDFDocument.load(two)).getPageCount();
    assert.ok(a >= 3, `90 gifts take more than two pages (took ${a})`);
    assert.equal(b, a + 1);
  });
  it('prints a name with accents and an unusual character without throwing', async () => {
    const env = hubEnv();
    const st = stmt([g('a', 1000)]);
    st.partner = { ...st.partner, addressee: 'José and Zoë Müller-Ñandú ’ 中', addressLines: ['12 Calle Ñ'] };
    const bytes = await pdfMod.buildPdf({ statements: [st], copy: copyMod.DEFAULT_COPY, yearEnd: false, issued: `${YEAR + 1}-01-20`, ...(await assetsFor(env)) });
    assert.ok(bytes.length > 1000);
  });
  it('prints with no gifts at all', async () => {
    const env = hubEnv();
    const bytes = await pdfMod.buildPdf({ statements: [stmt([])], copy: copyMod.DEFAULT_COPY, yearEnd: false, issued: `${YEAR + 1}-01-20`, ...(await assetsFor(env)) });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  });
});

/* ----------------------------------------------------------- reads, with a copy */

function world() {
  const w = mirrorWorld(YEAR);
  w.person(1, { first: 'Ann', last: 'Lee', spouseFirst: 'Bo', spouseLast: 'Lee', email: 'ann@example.org' })
    .person(2, { first: 'Cy', last: 'Day', address: false, email: 'cy@example.org' })
    .person(3, { first: 'Di', last: 'Poe', address: false })
    .person(4, { org: 'Sample Church', codes: ['Church'] })
    .person(5, { first: 'Ed', last: 'Fox' })
    .person(900, { org: 'Sample Giving Fund', codes: ['DAF Provider'] });
  // Ann and Bo Lee: every kind of row
  w.gift(1, 20000, `${Y}-02-01`, { id: 'g1' })
    .gift(1, 5000, `${Y}-03-01`, { id: 'g2', type: 'RecurringGiftPayment', method: 'CreditCard' })
    .gift(1, 5000, `${Y}-04-01`, { id: 'g3', type: 'RecurringGiftPayment', method: 'CreditCard' })
    .gift(1, 0, `${Y}-05-01`, { id: 'g4', type: 'RecurringGiftPayment', reference: 'HARDREJECT: Invalid account number.' })
    .gift(1, 5000, `${Y}-01-01`, { id: 'g5', type: 'RecurringGift' })
    .gift(1, 7500, `${Y}-06-01`, { id: 'g6', reference: 'HardReject: Stolen or lost card.' })
    .gift(1, 40000, `${Y}-07-01`, { id: 'g7', reference: 'Stock Gift' })
    .gift(1, 3000, `${Y}-08-01`, { id: 'g8', fund: 'f3' })
    .gift(900, 100000, `${Y}-09-01`, { id: 'g9', soft: [{ id: 1 }], fund: 'f2' })
    .gift(1, 5000, `${Number(Y) + 1}-01-02`, { id: 'g10' });
  w.gift(2, 30000, `${Y}-03-03`, { id: 'g11' }).gift(3, 40000, `${Y}-03-04`, { id: 'g12' }).gift(4, 500000, `${Y}-03-05`, { id: 'g13' }).gift(5, 10000, `${Y}-03-06`, { id: 'g14' });
  // filler partners on the mail list
  for (let i = 0; i < 25; i++) w.person(100 + i, { first: 'Pat', last: `Filler${String(i).padStart(2, '0')}` }).gift(100 + i, 30000 + i * 100, `${Y}-04-${String((i % 27) + 1).padStart(2, '0')}`, { id: `f${i}` });
  return w;
}

describe('reads from the Blackbaud copy', () => {
  it('finds a partner by Blackbaud ID and by any part of a name, couples and organizations too', async () => {
    const w = world();
    assert.equal((await data.findPartners(w.sql, '101'))[0].name, 'Ann and Bo Lee');
    assert.equal((await data.findPartners(w.sql, 'bo lee'))[0].lookup, '101');
    assert.equal((await data.findPartners(w.sql, 'church'))[0].name, 'Sample Church');
    assert.deepEqual(await data.findPartners(w.sql, 'a'), []);
    assert.deepEqual(await data.findPartners(w.sql, 'zzzz'), []);
  });
  it('builds the whole statement for one partner from the rows, every rule at once', async () => {
    const w = world();
    const s = await svc.statementFor(w.sql, { cid: '1', year: Y, from: '', to: '', includeSoft: true });
    assert.equal(s.partner.addressee, 'Ann and Bo Lee');
    assert.deepEqual(s.gifts.map((l) => l.giftId), ['g1', 'g2', 'g3', 'g7']);
    assert.equal(s.totals.gifts, 70000);
    assert.equal(s.totals.notDeductible, 3000);
    assert.equal(s.totals.soft, 100000);
    assert.deepEqual(s.left.map((l) => l.reason).sort(), ['declined', 'schedule', 'zero']);
    assert.equal(s.totals.taxBasis, 20000 + 5000 + 5000 + 7500 + 40000 + 3000);
    assert.equal(s.gifts.at(-1).fund, 'Where Needed Most');
    assert.ok(s.gifts.at(-1).flags.includes('noncash'));
    assert.equal(s.soft[0].from, 'Sample Giving Fund');
  });
  it('reads a range of dates', async () => {
    const w = world();
    const s = await svc.statementFor(w.sql, { cid: '1', year: '', from: `${Y}-03-01`, to: `${Y}-04-30`, includeSoft: false });
    assert.deepEqual(s.gifts.map((l) => l.giftId), ['g2', 'g3']);
  });
  it('refuses a partner that is not there and a bad id', async () => {
    const w = world();
    await assert.rejects(svc.statementFor(w.sql, { cid: '99999', year: Y, from: '', to: '', includeSoft: true }), /not in the Blackbaud copy/);
    await assert.rejects(svc.statementFor(w.sql, { cid: 'x', year: Y, from: '', to: '', includeSoft: true }), /Pick a partner/);
    await assert.rejects(svc.statementFor(w.sql, { cid: '1', year: '', from: '2026-01-01', to: '2025-01-01', includeSoft: true }), /before/);
  });
});

/* ----------------------------------------------------------- one statement made */

describe('a single statement', () => {
  it('makes the PDF, keeps a record and a log line, and can be made again', async () => {
    const w = world();
    const env = hubEnv();
    const a = await svc.makeSingle(env, w.sql, 'Desk Person', { cid: '1', year: Y, from: '', to: '', includeSoft: true });
    assert.equal(a.batch.kind, 'single');
    assert.equal(a.batch.status, 'made');
    assert.equal(a.batch.amount_cents, 70000);
    assert.ok(env.UPLOADS.files.has(a.batch.pdf_key));
    const again = await svc.makeSingle(env, w.sql, 'Desk Person', { cid: '1', year: Y, from: '', to: '', includeSoft: true });
    assert.notEqual(again.batch.id, a.batch.id);
    const log = await env.DB.prepare('SELECT COUNT(*) AS n FROM stm_log WHERE kind = ?').bind('single').first();
    assert.equal(log.n, 2);
    const issued = await env.DB.prepare('SELECT COUNT(*) AS n FROM stm_issued').first();
    assert.equal(issued.n, 0, 'a single statement is made, not issued');
  });
  it('saves a copy to the folder in US Team Files only when Admin names one, named by Blackbaud ID and dates', async () => {
    const w = world();
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
    const key = JSON.stringify({ client_email: 'sa@example.org', private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----` });
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ id: 'drivefile1' }), { status: 200 });
    };
    try {
      const off = hubEnv({ GOOGLE_SA_JSON: key });
      const none = await svc.makeSingle(off, w.sql, 'Desk Person', { cid: '1', year: Y, from: '', to: '', includeSoft: true });
      assert.equal(none.batch.drive_file, '');
      assert.equal(calls.length, 0, 'no folder set: nothing leaves the hub');
      const on = hubEnv({ GOOGLE_SA_JSON: key });
      await on.DB.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('statements.drive_folder', 'folderid12345', 'a', 'now')").run();
      const made = await svc.makeSingle(on, w.sql, 'Desk Person', { cid: '1', year: Y, from: '', to: '', includeSoft: true });
      assert.equal(made.batch.drive_file, 'drivefile1');
      const upload = calls.find((c) => c.url.includes('/upload/drive/v3/files'));
      const text = Buffer.from(upload.body).toString('latin1');
      assert.match(text, /"parents":\["folderid12345"\]/);
      assert.match(text, new RegExp(`"name":"Giving statement 101 ${Y}\.pdf"`));
      assert.ok(!/Lee/.test(text.slice(0, text.indexOf('%PDF'))), 'no partner name in the file name');
    } finally {
      globalThis.fetch = real;
    }
  });
});

/* ----------------------------------------------------------- the year-end run */

async function run(w, env, list, over = {}) {
  return svc.makeYearEnd(env, w.sql, WHO, { year: YEAR, list, includeSoft: false, size: 10, ...over });
}

describe('the year-end run', () => {
  it('reads the three tax lists and every statement total ties to its list total', async () => {
    const w = world();
    const env = hubEnv();
    const plan = await svc.yearEndPlan(env, w.sql, WHO, YEAR);
    assert.equal(plan.lists.mail.count, 26, 'Ann and Bo plus 25 fillers');
    assert.equal(plan.lists.email.count, 1);
    assert.equal(plan.lists.other.count, 1);
    assert.equal(plan.none.count, 3, 'the church, the DAF provider and the partner under $250');
    const direct = plan.ties.find((t) => /every gift of the year/.test(t.label));
    assert.equal(direct.status, 'match');
    assert.equal(direct.mine, direct.other);
    const { batch, mismatches } = await run(w, env, 'mail');
    assert.equal(mismatches, 0, 'each partner\'s statement basis equals the tax list total');
    assert.equal(batch.basis_cents, JSON.parse(batch.partners).reduce((t, p) => t + p.basis, 0));
  });
  it('makes files of the set size, one open file at a time, and never puts a partner in two files', async () => {
    const w = world();
    const env = hubEnv();
    const first = await run(w, env, 'mail');
    assert.equal(first.batch.count, 10);
    assert.equal(first.batch.status, 'printing');
    assert.equal(first.batch.seq, 1);
    await assert.rejects(run(w, env, 'mail'), (e) => e.code === 'open_file');
    await assert.rejects(run(w, env, 'email'), (e) => e.code === 'open_file');
    await store.markPrinted(env, first.batch.id, 'Desk Person');
    const second = await run(w, env, 'mail');
    await store.markPrinted(env, second.batch.id, 'Desk Person');
    const third = await run(w, env, 'mail');
    assert.equal(third.batch.count, 6);
    assert.equal(third.batch.seq, 3);
    await store.markPrinted(env, third.batch.id, 'Desk Person');
    await assert.rejects(run(w, env, 'mail'), (e) => e.code === 'none_left');
    const all = [first, second, third].flatMap((r) => JSON.parse(r.batch.partners).map((p) => p.id));
    assert.equal(all.length, 26);
    assert.equal(new Set(all).size, 26, 'no partner twice');
    const issued = await store.issuedFor(env, YEAR);
    assert.equal(issued.size, 26);
  });
  it('a second run after everything is printed makes nothing new', async () => {
    const w = world();
    const env = hubEnv();
    for (const list of ['mail', 'mail', 'mail']) {
      const r = await run(w, env, list);
      await store.markPrinted(env, r.batch.id, 'Desk Person');
    }
    const plan = await svc.yearEndPlan(env, w.sql, WHO, YEAR);
    assert.equal(plan.lists.mail.remaining, 0);
    assert.equal(plan.lists.mail.issued, 26);
    await assert.rejects(run(w, env, 'mail'), (e) => e.code === 'none_left');
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM stm_batches WHERE kind = 'yearend'").first();
    assert.equal(rows.n, 3);
  });
  it('orders mail by ZIP and the other lists by name', () => {
    const mk = (zip, sortName) => ({ partner: { zip, sortName } });
    const rows = [mk('33100-1234', 'b'), mk('32000', 'z'), mk('33100', 'a')];
    assert.deepEqual([...rows].sort(svc.printOrder('mail')).map((r) => r.partner.sortName), ['z', 'a', 'b']);
    assert.deepEqual([...rows].sort(svc.printOrder('email')).map((r) => r.partner.sortName), ['a', 'b', 'z']);
  });
  it('makes a PDF with at least a page for each statement, matching the file record', async () => {
    const w = world();
    const env = hubEnv();
    const r = await run(w, env, 'mail');
    const bytes = env.UPLOADS.files.get(r.batch.pdf_key);
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= r.batch.count);
    const entries = JSON.parse(r.batch.partners);
    assert.equal(entries.length, 10);
    assert.ok(entries.every((e) => e.cents > 0 && e.basis === e.cents));
  });
  it('a file holds the listed partner only once and counts gifts and dollars of the gifts listed', async () => {
    const w = world();
    const env = hubEnv();
    // Ann and Bo have a stock gift and a not-deductible gift: their statement lists 4 gifts for $700.00 net.
    const r = await run(w, env, 'mail', { size: 500 });
    const ann = JSON.parse(r.batch.partners).find((p) => p.lookup === '101');
    assert.equal(ann.cents, 70000);
    assert.equal(ann.basis, 80500);
    assert.equal(r.batch.gifts, 4 + 25);
  });
  it('throws a print file away: its partners go back on the list and the file is closed', async () => {
    const w = world();
    const env = hubEnv();
    const r = await run(w, env, 'mail');
    assert.equal((await store.issuedFor(env, YEAR)).size, 10);
    await store.discard(env, r.batch.id, 'Desk Person');
    assert.equal((await store.issuedFor(env, YEAR)).size, 0);
    assert.equal(await store.openYearEnd(env), null);
    const again = await run(w, env, 'mail');
    assert.equal(again.batch.count, 10);
    await assert.rejects(store.discard(env, r.batch.id, 'x'), (e) => e.code === 'closed');
  });
  it('refuses to mark a printed file again as discarded', async () => {
    const w = world();
    const env = hubEnv();
    const r = await run(w, env, 'mail');
    await store.markPrinted(env, r.batch.id, 'Desk Person');
    await assert.rejects(store.discard(env, r.batch.id, 'x'), (e) => e.code === 'closed');
    const same = await store.markPrinted(env, r.batch.id, 'Desk Person');
    assert.equal(same.status, 'printed');
  });
  it('two people pressing at once make one file', async () => {
    const w = world();
    const env = hubEnv();
    const results = await Promise.allSettled([run(w, env, 'mail'), run(w, env, 'mail')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await store.issuedFor(env, YEAR)).size, 10);
  });
  it('skips a listed partner with nothing tax-deductible to print and does not offer them again', async () => {
    const w = mirrorWorld(YEAR);
    w.person(1, { first: 'Gil', last: 'Hart' }).gift(1, 30000, `${Y}-02-02`, { id: 'q1', fund: 'f3' });
    w.person(2, { first: 'Hal', last: 'Ives' }).gift(2, 30000, `${Y}-02-03`, { id: 'q2' });
    const env = hubEnv();
    const r = await svc.makeYearEnd(env, w.sql, WHO, { year: YEAR, list: 'mail', includeSoft: false, size: 10 });
    assert.equal(r.batch.count, 1);
    assert.equal(r.batch.skipped, 1);
    const skipped = JSON.parse(r.batch.partners).find((p) => p.skipped);
    assert.match(skipped.skipped, /Nothing tax-deductible/);
    assert.equal((await store.issuedFor(env, YEAR)).size, 2);
  });
  it('the plan reports the open file, the files made, and the independent year total', async () => {
    const w = world();
    const env = hubEnv();
    const r = await run(w, env, 'mail');
    const plan = await svc.yearEndPlan(env, w.sql, WHO, YEAR);
    assert.equal(plan.open.id, r.batch.id);
    assert.equal(plan.batches.length, 1);
    assert.equal(plan.lists.mail.issued, 10);
    assert.equal(plan.lists.mail.remaining, 16);
    assert.equal(plan.size, 100);
  });
  it('compares the current year with the KPI dashboard, and says plainly when the dashboard does not answer', async () => {
    const thisYear = Number(YEAR) + 1;
    const w = mirrorWorld(thisYear);
    w.person(1, { first: 'Ivy', last: 'Joy' }).gift(1, 30000, `${thisYear}-01-05`, { id: 'k1' }).gift(1, 20000, `${thisYear}-02-05`, { id: 'k2' });
    const answer = (giving) => ({ KPI_JWT_SECRET: 's', KPI: { fetch: async () => new Response(JSON.stringify({ totals: { allSources: { giving } } }), { status: 200 }) } });
    const ok = await svc.yearEndPlan(hubEnv(answer([300, 200])), w.sql, WHO, thisYear);
    const kpi = ok.ties.find((t) => /KPI/.test(t.label));
    assert.equal(kpi.status, 'match');
    assert.equal(kpi.mine, 500);
    const off = await svc.yearEndPlan(hubEnv(answer([300, 250])), w.sql, WHO, thisYear);
    assert.equal(off.ties.find((t) => /KPI/.test(t.label)).status, 'differs');
    const last = await svc.yearEndPlan(hubEnv(), w.sql, WHO, YEAR);
    assert.equal(last.ties.find((t) => /KPI/.test(t.label)).status, 'none');
  });
});

/* -------------------------------------------------------------- email stays off */

describe('emailing a statement', () => {
  it('is off until Admin turns it on, and the hub asks to confirm because it contacts partners', async () => {
    const env = hubEnv();
    assert.equal(await store.emailOn(env), false);
    await assert.rejects(settings.changeSetting(env, 'admin@example.org', 'statements.email', 'on'), (e) => e.code === 'confirm' && /emails partners/.test(e.message));
    assert.equal(await store.emailOn(env), false);
    await settings.changeSetting(env, 'admin@example.org', 'statements.email', 'on', { confirm: true });
    assert.equal(await store.emailOn(env), true);
    const audit = await env.DB.prepare("SELECT before_value, after_value FROM hub_audit WHERE key = 'statements.email'").first();
    assert.deepEqual([audit.before_value, audit.after_value], ['off', 'on']);
  });
  it('sends nothing while it is off, and nothing leaves the building', async () => {
    const w = world();
    const env = hubEnv({ RESEND_API_KEY: 'k' });
    const r = await run(w, env, 'email');
    const sent = [];
    await assert.rejects(svc.emailStatements(env, w.sql, 'Desk Person', r.batch.id, [], async (u, i) => { sent.push(u); return new Response('{}'); }), (e) => e.code === 'email_off');
    assert.equal(sent.length, 0);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM stm_emails').first();
    assert.equal(rows.n, 0);
  });
  it('when on, sends one email with the PDF to each partner with an address, once, and records it', async () => {
    const w = world();
    const env = hubEnv({ RESEND_API_KEY: 'k' });
    await settings.changeSetting(env, 'admin@example.org', 'statements.email', 'on', { confirm: true });
    const r = await run(w, env, 'email');
    const sent = [];
    const fake = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    };
    const out = await svc.emailStatements(env, w.sql, 'Desk Person', r.batch.id, [], fake);
    assert.deepEqual(out, { sent: 1, failed: 0, skipped: 0 });
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.deepEqual(sent[0].body.to, ['cy@example.org']);
    assert.equal(sent[0].body.attachments.length, 1);
    assert.equal(sent[0].body.reply_to, 'info@favorintl.org');
    const again = await svc.emailStatements(env, w.sql, 'Desk Person', r.batch.id, [], fake);
    assert.equal(again.sent, 0);
    assert.equal(sent.length, 1, 'never twice for the same file');
  });
  it('records a failed send so it can be tried again', async () => {
    const w = world();
    const env = hubEnv({ RESEND_API_KEY: 'k' });
    await settings.changeSetting(env, 'admin@example.org', 'statements.email', 'on', { confirm: true });
    const r = await run(w, env, 'email');
    const out = await svc.emailStatements(env, w.sql, 'Desk Person', r.batch.id, [], async () => new Response('{}', { status: 500 }));
    assert.equal(out.failed, 1);
    const ok = await svc.emailStatements(env, w.sql, 'Desk Person', r.batch.id, [], async () => new Response('{}', { status: 200 }));
    assert.equal(ok.sent, 1);
  });
});

/* ---------------------------------------------------------------- admin words */

describe('wording in Admin settings', () => {
  it('lists every wording line and the switches under Giving statements', async () => {
    const env = hubEnv();
    const list = await settings.readArea(env, 'statements');
    const ids = list.map((s) => s.id);
    for (const w of copyMod.WORDING) assert.ok(ids.includes(w.id), w.id);
    assert.ok(ids.includes('statements.email') && ids.includes('statements.batch_size') && ids.includes('statements.drive_folder'));
    assert.equal(list.find((s) => s.id === 'statements.email').value, 'off');
    assert.equal(list.find((s) => s.id === 'statements.w.goods').value, copyMod.DEFAULT_COPY.goods);
  });
  it('a saved line reaches the next statement, and the audit log keeps the old line', async () => {
    const env = hubEnv();
    await settings.changeSetting(env, 'admin@example.org', 'statements.w.goods', 'No goods or services were provided in exchange for your gifts.');
    const c = await store.getCopy(env);
    assert.equal(c.goods, 'No goods or services were provided in exchange for your gifts.');
    assert.equal(c.tax, copyMod.DEFAULT_COPY.tax);
    const a = await env.DB.prepare("SELECT before_value FROM hub_audit WHERE key = 'statements.w.goods'").first();
    assert.equal(a.before_value, copyMod.DEFAULT_COPY.goods);
  });
  it('checks the print file size and the folder id', async () => {
    const env = hubEnv();
    await assert.rejects(settings.changeSetting(env, 'a', 'statements.batch_size', '5'), /10 to 500/);
    await assert.rejects(settings.changeSetting(env, 'a', 'statements.drive_folder', 'not a folder!'), /letters, digits/);
    await settings.changeSetting(env, 'a', 'statements.batch_size', '50');
    assert.equal(await store.batchSize(env), 50);
  });
});

/* ------------------------------------------------------------------- the routes */

describe('who may open the routes', () => {
  const call = (mod, env, url, user, init = {}) => mod[init.method === 'POST' ? 'onRequestPost' : 'onRequestGet']({ request: user ? asUser(url, user, init) : new Request(url, init), env, params: {} });

  it('turns away a request with no sign-in, and a staff member who does not work on statements', async () => {
    const env = hubEnv();
    assert.equal((await call(me, env, 'https://hub.test/api/statements/me', null)).status, 401);
    assert.equal((await call(me, env, 'https://hub.test/api/statements/me', { email: 's@example.org', name: 'S', role: 'staff' })).status, 403);
  });
  it('lets a hub admin and the admin desk in', async () => {
    const env = hubEnv();
    const ok = await call(me, env, 'https://hub.test/api/statements/me', { email: 'a@example.org', name: 'A', role: 'admin' });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.emailOn, false);
    assert.equal(body.defaultYear, Number(body.today.slice(0, 4)) - 1);
    await env.DB.exec('CREATE TABLE rpt_people (email TEXT, audience TEXT)');
    await env.DB.prepare("INSERT INTO rpt_people (email, audience) VALUES ('desk@example.org', 'admin_desk')").run();
    assert.equal((await call(me, env, 'https://hub.test/api/statements/me', { email: 'desk@example.org', name: 'D', role: 'staff' })).status, 200);
  });
  it('refuses a change that did not come from the hub page', async () => {
    const env = hubEnv();
    const res = await yearend.onRequestPost({
      request: asUser('https://hub.test/api/statements/yearend', { email: 'a@example.org', name: 'A', role: 'admin' }, { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' }),
      env,
      params: {},
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'cross_site');
  });
});
