// Run with: npm test
//
// Reports group B1, daily and weekly: Daily Revenue Report (the post text), Weekly recurring, 2026 YTD Income, Month to month and
// Deposit highlights. A stand-in mirror answers every query from made-up gifts, so each report is run end to end through the engine and
// its totals are checked against the stand-in KPI figures. The repository is public: every name and number here is invented.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const engine = await import('../functions/_lib/reports/engine.ts');
const shared = await import('../functions/_lib/reports/defs/b1-shared.ts');
const daily = (await import('../functions/_lib/reports/defs/daily-revenue.ts')).default;
const weekly = (await import('../functions/_lib/reports/defs/weekly-recurring.ts')).default;
const ytd = (await import('../functions/_lib/reports/defs/ytd-income.ts')).default;
const m2m = (await import('../functions/_lib/reports/defs/month-to-month.ts')).default;
const deposit = (await import('../functions/_lib/reports/defs/deposit.ts')).default;
const depositMod = await import('../functions/_lib/reports/defs/deposit.ts');
const reg = await import('../functions/_lib/reports/registry.ts');

/* ------------------------------------------------------------------ made-up mirror */

const PEOPLE = {
  1: { name: 'Pat Giver', st: 'FL', country: 'United States' },
  2: { name: 'Sam Newcomer', st: 'OH', country: 'United States' },
  3: { name: 'Donor Advised Fund Example', st: 'TX', country: 'United States' },
  4: { name: 'Lee Soft', st: 'WA', country: 'United States' },
  5: { name: 'Ann Portfolio', st: 'GA', country: 'United States' },
  6: { name: 'Overseas Friend', st: null, country: 'New Zealand' },
  7: { name: 'Quiet Partner', st: 'NC', country: 'United States' },
};
const APPEALS = {
  a1: { code: 'Website', cat: 'White Mail' },
  a2: { code: 'D2610-NEWS', cat: 'Digital Newsletter' },
  a3: { code: 'P200-RDAD', cat: 'Portfolio' },
  a4: { code: 'L2601-MAIL', cat: 'Direct Mail Appeal' },
  a5: { code: 'Z900-OTHER', cat: 'Other/Exception' },
};
const FUNDS = { f1: 'General Fund', f2: 'Water Wells' };
const RAISERS = { r1: ['Richard', 'Brown'], r2: ['Stephanie', 'Brady'] };
// Open assignments by partner. Partner 7 holds two. Partner 2 holds only one of the three the query leaves out. Partner 1 holds one the fundraiser table does not list.
const ASSIGN = { 5: ['r1'], 7: ['r1', 'r2'], 2: ['32148'], 1: ['x9'] };
const sp = (amount, appeal, fund) => ({ amount: { value: amount }, appeal_id: appeal, fund_id: fund });

// Gift 11 is Pat's first gift (new partner), 12 a later gift, 13 a DAF gift split in two with a soft credit.
const GIFTS = [
  { id: '11', cid: '2', amount: 250, d: '2026-09-29', gtype: 'Donation', pm: 'CreditCard', splits: [sp(250, 'a1', 'f1')], soft: [], fr: [] },
  { id: '12', cid: '1', amount: 40.5, d: '2026-09-29', gtype: 'Donation', pm: 'CreditCard', splits: [sp(40.5, 'a2', 'f1')], soft: [], fr: [] },
  { id: '13', cid: '3', amount: 5000, d: '2026-09-29', gtype: 'Donation', pm: 'PersonalCheck', splits: [sp(3000, 'a4', 'f1'), sp(2000, 'a4', 'f2')], soft: [{ constituent_id: '4' }], fr: [] },
  { id: '14', cid: '5', amount: 1500, d: '2026-09-30', gtype: 'Donation', pm: 'PersonalCheck', splits: [sp(1500, 'a3', 'f1')], soft: [], fr: [] },
  { id: '15', cid: '1', amount: 25, d: '2026-09-30', gtype: 'RecurringGiftPayment', pm: 'DirectDebit', splits: [sp(25, 'a3', 'f1')], soft: [], fr: [], link: '900' },
  { id: '16', cid: '6', amount: 1200, d: '2026-09-30', gtype: 'Donation', pm: 'Cash', splits: [sp(1200, 'a5', 'f1')], soft: [], fr: [] },
  { id: '17', cid: '7', amount: 100, d: '2026-10-01', gtype: 'Donation', pm: 'CreditCard', splits: [sp(100, 'a4', 'f1')], soft: [], fr: [], consistent: true },
  { id: '18', cid: '1', amount: 30, d: '2026-10-02', gtype: 'RecurringGiftPayment', pm: 'DirectDebit', splits: [sp(30, 'a3', 'f1')], soft: [], fr: [], link: '900' },
  { id: '19', cid: '2', amount: 75, d: '2026-10-05', gtype: 'Donation', pm: 'PersonalCheck', splits: [sp(75, 'a4', 'f1')], soft: [], fr: [] },
  { id: '20', cid: '7', amount: 0, d: '2026-10-05', gtype: 'Donation', pm: 'Cash', splits: [sp(0, 'a4', 'f1')], soft: [], fr: [] },
  { id: '90', cid: '1', amount: 25, d: '2026-09-01', gtype: 'RecurringGift', pm: 'DirectDebit', splits: [], soft: [], fr: [] },
  { id: '91', cid: '1', amount: 500, d: '2025-09-15', gtype: 'Donation', pm: 'CreditCard', splits: [sp(500, 'a2', 'f1')], soft: [], fr: [] },
];
const BATCH = { 13: 'GFT-2026-0001', 14: 'GFT-2026-0001', 16: 'GFT-2026-0002' };
// Partner 1's first gift is 91 (2025). Partner 2's first gift is 11. Partner 7's first is 17.
const money2 = (x) => Math.round(x * 100) / 100;
// The Gift ID staff see is the lookup id, which is not the record id the mirror keys on.
const lookup = (id) => String(1000 + Number(id));

function mirror(gifts = GIFTS) {
  const counted = (g) => g.amount > 0 && g.gtype !== 'RecurringGift';
  return async (sql, params = []) => {
    if (sql.includes('AS cid, gift_amount AS amount')) {
      return gifts
        .filter((g) => counted(g) && g.d >= params[0] && g.d <= params[1])
        .sort((a, b) => (a.d + a.id < b.d + b.id ? -1 : 1))
        .map((g) => ({ id: g.id, lid: lookup(g.id), cid: g.cid, amount: g.amount, d: g.d, gtype: g.gtype, pm: g.pm, splits: JSON.stringify(g.splits), soft: JSON.stringify(g.soft), fr: JSON.stringify(g.fr) }));
    }
    if (sql.includes('FROM constituents c WHERE c.id IN')) {
      return JSON.parse(params[0]).map((id) => ({ id, name: PEOPLE[id]?.name, sk: (PEOPLE[id]?.name || '').split(' ').reverse().join(' ').toLowerCase(), st: PEOPLE[id]?.st ?? null, country: PEOPLE[id]?.country ?? null }));
    }
    if (sql.includes('json_each(g.soft_credits)')) {
      return JSON.parse(params[0]).map((cid) => {
        const mine = gifts.filter((g) => counted(g) && g.soft.some((x) => x.constituent_id === cid)).sort((a, b) => (a.d + a.id < b.d + b.id ? -1 : 1));
        return mine.length ? { cid, s: mine.reduce((t, g) => t + g.amount, 0), fk: mine[0].d + 'T00:00:00|' + lookup(mine[0].id) } : null;
      }).filter(Boolean);
    }
    if (sql.includes('AS life')) {
      return JSON.parse(params[0]).map((cid) => {
        const mine = gifts.filter((g) => g.cid === cid && counted(g)).sort((a, b) => (a.d + a.id < b.d + b.id ? -1 : 1));
        return { cid, life: mine.reduce((s, g) => s + g.amount, 0), fk: mine[0] ? mine[0].d + 'T00:00:00|' + lookup(mine[0].id) : null };
      });
    }
    if (sql.includes('FROM appeals')) return JSON.parse(params[0]).map((id) => ({ id, code: APPEALS[id].code, cat: APPEALS[id].cat }));
    if (sql.includes('FROM funds WHERE id IN')) return JSON.parse(params[0]).map((id) => ({ id, fund: FUNDS[id] }));
    if (sql.includes('FROM assignments')) {
      const out = [];
      for (const cid of JSON.parse(params[0])) for (const fid of ASSIGN[cid] || []) if (!JSON.parse(params[1]).includes(fid)) out.push({ cid, fid });
      return out;
    }
    if (sql.includes('FROM fundraisers')) return Object.entries(RAISERS).map(([id, n]) => ({ id, first: n[0], last: n[1] }));
    if (sql.includes('gift_custom_fields')) return gifts.filter((g) => g.consistent).map((g) => ({ gift_id: g.id }));
    if (sql.includes("json_extract(raw_json, '$.batch_number')")) return JSON.parse(params[0]).map((id) => ({ id, b: BATCH[id] || null }));
    if (sql.includes('AS d, SUM(gift_amount) AS s, COUNT(*) AS n')) {
      const by = {};
      for (const g of gifts.filter((x) => counted(x) && x.d >= params[0] && x.d <= params[1])) (by[g.d] ||= { d: g.d, s: 0, n: 0 }), (by[g.d].s += g.amount), by[g.d].n++;
      return Object.values(by);
    }
    if (sql.includes('substr(gift_date, 1, 7) AS m')) {
      const by = {};
      for (const g of gifts.filter((x) => counted(x) && x.d.slice(0, 7) >= params[0] && x.d.slice(0, 7) <= params[1])) {
        const m = g.d.slice(0, 7);
        by[m] ||= { m, s: 0, n: 0, rs: 0, rn: 0 };
        by[m].s += g.amount;
        by[m].n++;
        if (g.gtype === 'RecurringGiftPayment') (by[m].rs += g.amount), by[m].rn++;
      }
      return Object.values(by);
    }
    if (sql.includes("g.gift_type = 'RecurringGiftPayment'")) {
      return gifts
        .filter((g) => g.gtype === 'RecurringGiftPayment' && g.amount > 0 && g.d >= params[0] && g.d <= params[1])
        .sort((a, b) => (a.d + a.id < b.d + b.id ? -1 : 1))
        .map((g) => ({ date: g.d, gift: g.id, partner: PEOPLE[g.cid].name, amount: g.amount, setup: g.link, fund: FUNDS[g.splits[0].fund_id] }));
    }
    if (sql.includes("gift_type = 'RecurringGiftPayment' AND gift_amount > 0")) {
      return [{ s: gifts.filter((g) => g.gtype === 'RecurringGiftPayment' && g.amount > 0 && g.d.slice(0, 7) === params[0]).reduce((s, g) => s + g.amount, 0) }];
    }
    if (sql.includes('gift_amount >= 1000')) {
      const cardless = sql.includes('PersonalCheck');
      return [{ s: gifts.filter((g) => g.d === params[0] && g.amount >= 1000 && g.gtype !== 'RecurringGift' && (!cardless || ['PersonalCheck', 'Cash'].includes(g.pm))).reduce((s, g) => s + g.amount, 0) }];
    }
    if (sql.includes('COALESCE(SUM(gift_amount), 0) AS s FROM gifts WHERE substr(gift_date, 1, 7)')) {
      return [{ s: gifts.filter((g) => counted(g) && g.d.slice(0, 7) >= params[0] && g.d.slice(0, 7) <= params[1]).reduce((s, g) => s + g.amount, 0) }];
    }
    throw new Error('stand-in mirror has no answer for: ' + sql.slice(0, 120));
  };
}

// The stand-in KPI dashboard computes its figures from the same made-up gifts by its own path.
function kpiFrom(gifts = GIFTS) {
  const m = Array.from({ length: 12 }, () => 0);
  const n = Array.from({ length: 12 }, () => 0);
  const r = Array.from({ length: 12 }, () => 0);
  const rn = Array.from({ length: 12 }, () => 0);
  for (const g of gifts.filter((x) => x.d.startsWith('2026') && x.amount > 0 && x.gtype !== 'RecurringGift')) {
    const i = Number(g.d.slice(5, 7)) - 1;
    m[i] += g.amount;
    n[i]++;
    if (g.gtype === 'RecurringGiftPayment') (r[i] += g.amount), rn[i]++;
  }
  const mm = m.map((x) => (x ? money2(x) : null));
  return async () => ({ asOf: '2026-10-05', monthlyGiving: mm, monthlyGifts: n, monthlyRecurring: r.map((x) => (x ? money2(x) : null)), monthlyRecurringGifts: rn, ytdRevenue: money2(m.reduce((a, b) => a + b, 0)), ytdGifts: n.reduce((a, b) => a + b, 0), status: null });
}

const run = (def, asked = {}, o = {}) =>
  engine.runReport({}, def, { user: { email: 'desk@x.org', name: 'Desk' }, asked, name: def.id, today: '2026-10-05', sql: mirror(), kpi: kpiFrom(), edits: {}, ...o });

/* ------------------------------------------------------------------ text helpers */

describe('money and dates, as the browser script prints them', () => {
  it('drops cents on whole dollars and keeps two places otherwise', () => {
    assert.equal(shared.money(1250), '$1,250');
    assert.equal(shared.money(1250.5), '$1,250.50');
    assert.equal(shared.money(0.5), '$0.50');
    assert.equal(shared.money(9628.550000000001), '$9,628.55');
    assert.equal(shared.money(-5), '-$5');
  });
  it('writes ordinals and long dates', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 20, 21, 22, 23, 30, 31].map(shared.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '20th', '21st', '22nd', '23rd', '30th', '31st']);
    assert.equal(shared.longDate('2026-10-09'), 'October 9th, 2026');
  });
  it('covers Friday to Sunday on a Monday and yesterday on every other day', () => {
    assert.deepEqual(shared.lastBusinessRange('2026-10-05'), { from: '2026-10-02', to: '2026-10-04' });
    assert.deepEqual(shared.lastBusinessRange('2026-10-07'), { from: '2026-10-06', to: '2026-10-06' });
  });
});

/* ------------------------------------------------------------------ Daily Revenue Report */

describe('Daily Revenue Report post', () => {
  const dayRun = (from, to, hour = 9) => {
    const asked = { mode: 'range', from, to };
    return run(daily, asked).then((r) => r);
  };

  it('prints one day with a new partner, the note, the blocks sorted by total, and the footer blocks', async () => {
    const r = await run(daily, { mode: 'day', day: '2026-09-29' });
    const lines = r.post.split('\n');
    assert.match(lines[0], /^Good (Morning|Afternoon|Evening), Team!$/);
    assert.equal(lines[1], '');
    assert.equal(lines[2], '');
    assert.equal(lines[3], 'Please see the Daily Revenue Report for September 29th, 2026.');
    assert.ok(r.post.includes('Total received: $5,290.50 from 3 gifts.'));
    assert.ok(r.post.includes('Please note, gifts of $1,000 and up, RDD portfolio gifts, and new partners will be highlighted. All other information will be in Blackbaud for specific review.'));
    // Sam's first gift is a Website gift: the new partner is listed under Website. Pat's gift is a Digital Newsletter gift, not new.
    assert.ok(r.post.includes('\n\n\nWebsite: $250 \n* $250 | Sam Newcomer (*New Partner*) | General Fund | Website - Partner Care'));
    assert.ok(!r.post.includes('Pat Giver'));
    // Gift 13: a DAF gift split 60/40 with a soft credit; the hard credit prints first, the soft credit after the pipe.
    assert.ok(r.post.includes('* $5,000 | DAF Example (*New Partner*) | Lee Soft (*New Partner*) | Split 60/40 | General Fund & Water Wells | Direct Mail - Brian'));
    assert.ok(r.post.includes('RDD Highlights (included in total):'));
  });

  it('puts a gift of $1,000 and up in the highlights, a portfolio gift in RDD Portfolio Giving, and shortens staff and organizations', async () => {
    const r = await run(daily, { mode: 'day', day: '2026-09-30' });
    // Gift 14: portfolio appeal credited to a director on the list. Gift 16: overseas, $1,200, Other/Exception, follow-up Celeste.
    assert.ok(r.post.includes('RDD Portfolio Giving: $1,500 \n* $1,500 | Ann Portfolio (*New Partner*) | General Fund - Rick'));
    assert.ok(r.post.includes('* $1,200 | Overseas Friend (*New Partner*) | General Fund | Other/Exception - No follow-up'));
    assert.ok(r.post.includes('Recurring Giving (included in total): $25'));
    const hi = r.post.split('RDD Highlights (included in total):')[1].trim().split('\n');
    assert.equal(hi.length, 2);
    assert.ok(hi[0].startsWith('* $1,500 | Ann Portfolio'));
  });

  it('drops categories with a zero total and sorts the rest largest first', async () => {
    const r = await dayRun('2026-09-29', '2026-10-01');
    const heads = [...r.post.matchAll(/\n\n\n([A-Za-z/ ]+): \$[\d,.]+ /g)].map((m) => m[1]);
    assert.ok(heads.length >= 3);
    const totals = [...r.post.matchAll(/\n\n\n[A-Za-z/ ]+: \$([\d,.]+) /g)].map((m) => Number(m[1].replace(/,/g, '')));
    assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
    assert.ok(!heads.includes('Event'));
  });

  it('prints a range with a spaced hyphen and counts each gift once', async () => {
    const r = await dayRun('2026-09-29', '2026-10-01');
    assert.ok(r.post.includes('for September 29th, 2026 - October 1st, 2026.'));
    assert.ok(r.post.includes('Total received: $8,115.50 from 7 gifts.'));
    assert.equal(r.rows.length, 7);
    assert.equal(r.totals.amount, 8115.5);
  });

  it('shows the Consistent Giving footer from the consistent tag, and no footer when the amount is zero', async () => {
    const r = await dayRun('2026-10-01', '2026-10-01');
    assert.ok(r.post.includes('Consistent Giving (included in total): $100'));
    assert.ok(!r.post.includes('Recurring Giving'));
    assert.ok(!r.post.includes('RDD Highlights'));
  });

  it('greets by the clock: Morning before noon, Afternoon from noon, Evening from five', () => {
    const grid = [];
    assert.match(shared.buildPost(grid, 9).text, /^Good Morning, Team!/);
    assert.match(shared.buildPost(grid, 12).text, /^Good Afternoon, Team!/);
    assert.match(shared.buildPost(grid, 16).text, /^Good Afternoon, Team!/);
    assert.match(shared.buildPost(grid, 17).text, /^Good Evening, Team!/);
  });

  it('is built from the hard credit and soft credit rows the way the query grid lists them', async () => {
    const grid = await shared.loadGrid({ sql: mirror() }, '2026-09-29', '2026-09-29');
    const g13 = grid.find((g) => g.id === '13');
    assert.equal(g13.rows.length, 4);
    assert.deepEqual(g13.rows.map((x) => [x.partner, x.softCredit, x.appealAmount]), [['Donor Advised Fund Example', 'Lee Soft', 3000], ['Donor Advised Fund Example', 'Lee Soft', 2000], ['Lee Soft', 'Lee Soft', 3000], ['Lee Soft', 'Lee Soft', 2000]]);
    assert.equal(g13.rows[0].appealID, 'L2601-MAIL');
    assert.equal(g13.rows[0].country, 'US');
    const post = shared.buildPost(grid, 9).text;
    assert.ok(post.includes('$5,000 | DAF Example (*New Partner*) | Lee Soft (*New Partner*) | Split 60/40 | General Fund & Water Wells | Direct Mail - Brian'));
  });

  it('reads the Fundraiser from the partner’s open assignments, one row each, and prints both in the follow-up', async () => {
    const r = await run(daily, { mode: 'day', day: '2026-10-01' });
    assert.ok(r.post.includes('* $100 | Quiet Partner (*New Partner*) | General Fund | Direct Mail - Rick & Stephanie'));
    assert.equal(r.rows.length, 1);
    assert.equal(r.totals.amount, 100);
    // A partner whose only assignment is on the left-out list has no Fundraiser, so the follow-up falls back to Partner Care.
    const sam = await run(daily, { mode: 'day', day: '2026-09-29' });
    assert.ok(sam.post.includes('Sam Newcomer (*New Partner*) | General Fund | Website - Partner Care'));
  });

  it('keeps the table rows in step with the post: one row per gift, the same total', async () => {
    const r = await dayRun('2026-09-29', '2026-09-30');
    assert.equal(r.rows.length, 6);
    const sum = r.rows.reduce((s, x) => s + x.amount, 0);
    assert.equal(money2(sum), r.totals.amount);
    assert.ok(r.tiles[0].value === r.totals.amount);
    const big = r.rows.find((x) => x.gift === '1013');
    assert.equal(big.flags.includes('$1,000 and up'), true);
  });

  it('ties a whole month to the KPI dashboard and three different periods all match', async () => {
    for (const [from, to] of [['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-05'], ['2026-09-01', '2026-10-05']]) {
      const r = await run(daily, { mode: 'range', from, to });
      assert.equal(r.tie.status, 'match', `${from} to ${to}: ${JSON.stringify(r.tie)}`);
      assert.equal(r.tie.diff, 0);
    }
  });

  it('shows Differs when the KPI figure is not the report total, and shows no tie-out line for part of a month', async () => {
    const wrong = async () => ({ ...(await kpiFrom()()), monthlyGiving: [null, null, null, null, null, null, null, null, 1, null, null, null] });
    const r = await run(daily, { mode: 'range', from: '2026-09-01', to: '2026-09-30' }, { kpi: wrong });
    assert.equal(r.tie.status, 'differs');
    const part = await run(daily, { mode: 'day', day: '2026-09-29' });
    assert.equal(part.tie.status, 'none');
  });

  it('is shown to the admin desk only', () => {
    assert.deepEqual(reg.entryOf('daily-revenue').audience, ['admin_desk']);
    assert.equal(reg.isReady('daily-revenue'), true);
  });
});

/* ------------------------------------------------------------------ Weekly recurring */

describe('Weekly recurring report', () => {
  it('lists the month-to-date payments, the post line and the Monday checkpoints', async () => {
    const r = await run(weekly, { month: '2026-10' });
    assert.equal(r.count, 1);
    assert.equal(r.post, 'Recurring Gift Total: $30 from 1 gifts');
    const sep = await run(weekly, { month: '2026-09' });
    assert.equal(sep.post, 'Recurring Gift Total: $25 from 1 gifts');
    assert.equal(sep.totals.amount, 25);
  });
  it('defaults to the current month through today', async () => {
    const r = await run(weekly, {});
    assert.equal(r.values.month, '');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].date, '2026-10-02');
  });
  it('ties the month to the KPI recurring line for three months and the through date checks the whole month', async () => {
    for (const month of ['2026-09', '2026-10']) {
      const r = await run(weekly, { month });
      assert.equal(r.tie.status, 'match', month);
    }
    const part = await run(weekly, { month: '2026-10', through: '2026-10-01' });
    assert.equal(part.rows.length, 0);
    assert.equal(part.tie.status, 'none');
    const bad = await run(weekly, { month: '2026-09' }, { kpi: async () => ({ ...(await kpiFrom()()), monthlyRecurring: Array.from({ length: 12 }, () => 3) }) });
    assert.equal(bad.tie.status, 'differs');
  });
  it('is shown to the admin desk only', () => assert.deepEqual(reg.entryOf('weekly-recurring').audience, ['admin_desk']));
});

/* ------------------------------------------------------------------ 2026 YTD Income */

describe('2026 YTD Income', () => {
  it('lists every day through today with the U.S. total and the typed-in Africa income', async () => {
    const r = await run(ytd, {}, { edits: { '2026-09-30|africa': '1234.50' } });
    assert.equal(r.rows.length, 278);
    assert.equal(r.rows[0].date, '2026-01-01');
    assert.equal(r.rows[r.rows.length - 1].date, '2026-10-05');
    const d = r.rows.find((x) => x.date === '2026-09-29');
    assert.deepEqual([d.us, d.gifts], [5290.5, 3]);
    assert.equal(r.rows.find((x) => x.date === '2026-09-30').africa, 1234.5);
    assert.equal(r.totals.africa, 1234.5);
    assert.equal(r.totals.us, money2(GIFTS.filter((g) => g.d.startsWith('2026') && g.amount > 0 && g.gtype !== 'RecurringGift').reduce((s, g) => s + g.amount, 0)));
    assert.deepEqual(r.editable, ['africa']);
    assert.equal(r.rows[0].__key, '2026-01-01');
  });
  it('ties the U.S. total to the KPI YTD revenue on three days of the year', async () => {
    for (const today of ['2026-09-29', '2026-09-30', '2026-10-05']) {
      const gifts = GIFTS.filter((g) => g.d <= today);
      const r = await run(ytd, {}, { today, sql: mirror(gifts), kpi: kpiFrom(gifts) });
      assert.equal(r.tie.status, 'match', today);
    }
    const r = await run(ytd, {}, { kpi: async () => ({ ...(await kpiFrom()()), ytdRevenue: 1 }) });
    assert.equal(r.tie.status, 'differs');
  });
  it('says so when the year is not the KPI year', async () => {
    const r = await run(ytd, { year: '2025' });
    assert.equal(r.tie.status, 'none');
    assert.equal(r.totals.us, 500);
  });
  it('is shown to the admin desk and leadership', () => assert.deepEqual(reg.entryOf('ytd-income').audience, ['admin_desk', 'leadership']));
});

/* ------------------------------------------------------------------ Month to month */

describe('Month to month', () => {
  it('has one row per month through the current one with recurring, change and year on year', async () => {
    const r = await run(m2m, {});
    assert.deepEqual(r.rows.map((x) => x.month), ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October']);
    const sep = r.rows[8];
    assert.deepEqual([sep.income, sep.gifts, sep.recurring, sep.recurringGifts, sep.other], [8015.5, 6, 25, 1, 7990.5]);
    const oct = r.rows[9];
    assert.equal(oct.change, money2(oct.income - sep.income));
    assert.equal(sep.lastYear, 500);
    assert.equal(r.rows[0].change, null);
  });
  it('adds up to the KPI YTD revenue and matches each KPI month', async () => {
    const r = await run(m2m, {});
    assert.equal(r.tie.status, 'match');
    assert.equal(r.totals.income, money2(r.rows.reduce((s, x) => s + x.income, 0)));
    const bad = await run(m2m, {}, { kpi: async () => ({ ...(await kpiFrom()()), monthlyGiving: [null, null, null, null, null, null, null, null, 5, null, null, null] }) });
    assert.equal(bad.tie.status, 'differs');
    assert.match(bad.tie.note, /September/);
  });
  it('is shown to the admin desk and leadership', () => assert.deepEqual(reg.entryOf('month-to-month').audience, ['admin_desk', 'leadership']));
});

/* ------------------------------------------------------------------ Deposit highlights */

describe('Deposit highlights for RDDs', () => {
  it('picks the latest Monday, Wednesday or Friday', () => {
    assert.equal(depositMod.lastDepositDay('2026-10-05'), '2026-10-05');
    assert.equal(depositMod.lastDepositDay('2026-10-06'), '2026-10-05');
    assert.equal(depositMod.lastDepositDay('2026-10-10'), '2026-10-09');
    assert.equal(depositMod.lastDepositDay('2026-10-08'), '2026-10-07');
  });
  it('lists gifts of $1,000 and up and portfolio gifts from checks and cash, with the batch and follow-up', async () => {
    const r = await run(deposit, { day: '2026-09-30' });
    assert.deepEqual(r.rows.map((x) => x.gift), ['1014', '1016']);
    assert.equal(r.rows[0].batch, 'GFT-2026-0001');
    assert.equal(r.rows[0].follow, 'Richard Brown');
    assert.equal(r.rows[0].why, '$1,000 and up, RDD portfolio, New partner');
    assert.equal(r.rows[1].method, 'Cash');
    assert.equal(r.totals.amount, 2700);
    assert.equal(r.tiles[1].value, 2);
  });
  it('leaves out card gifts unless all payments are chosen', async () => {
    const all = await run(deposit, { day: '2026-09-29', pay: 'all' });
    assert.deepEqual(all.rows.map((x) => x.gift), ['1013']);
    const cheques = await run(deposit, { day: '2026-09-29' });
    assert.deepEqual(cheques.rows.map((x) => x.gift), ['1013']);
  });
  it('ties the highlights to the $1,000 and up gifts of the same day for three deposit days', async () => {
    for (const day of ['2026-09-29', '2026-09-30', '2026-10-05']) {
      const r = await run(deposit, { day });
      assert.equal(r.tie.status, 'match', day);
    }
  });
  it('shows no highlights, and no error, on a day with no gifts', async () => {
    const r = await run(deposit, { day: '2026-10-03' });
    assert.equal(r.rows.length, 0);
    assert.equal(r.tie.status, 'match');
  });
  it('is shown to the admin desk only', () => assert.deepEqual(reg.entryOf('deposit').audience, ['admin_desk']));
});

describe('the group is live and read-only', () => {
  it('has a definition for each of the five reports', () => {
    for (const id of ['daily-revenue', 'weekly-recurring', 'ytd-income', 'month-to-month', 'deposit']) assert.equal(reg.isReady(id), true, id);
  });
  it('refuses to write through a report', async () => {
    const bad = { ...weekly, load: async (ctx) => ({ rows: await ctx.sql('UPDATE gifts SET gift_amount = 0') }) };
    await assert.rejects(() => run(bad, {}), /only read/);
  });
});
