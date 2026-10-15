// Builds an invented /api/hub/reporting answer with every team, through the server's own weeklyHighlight, so the cards and the
// sentences in a prototype come from one function. Invented partners and amounts only. Prints JSON to stdout.
//   node scripts/hl-fixture.mjs > fixture.json
import '../tests/support/resolve-ts.mjs';

const M = await import('../functions/_lib/hub/reporting-math.ts');
const asOf = '2026-10-14';
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Riverbend Church', 'Hope Foundation', 'Maya Okafor', 'Priya Nair', 'Daniel Ortiz', 'Cedar Hill Fellowship', 'Lumen Family Trust', 'North Gate Church'];
function rows(n, scale, from = '2026-08-01') {
  const out = [];
  const start = Date.parse(from + 'T12:00:00Z');
  const days = Math.round((Date.parse(asOf + 'T12:00:00Z') - start) / 864e5);
  for (let i = 0; i < n; i++) {
    const d = new Date(start + Math.floor(rnd() * (days + 1)) * 864e5).toISOString().slice(0, 10);
    const amt = Math.round((rnd() ** 3) * scale * 100) / 100 + 25;
    const k = Math.floor(rnd() * NAMES.length);
    out.push({ date: d, partner: NAMES[k], cid: String(20000 + k), amount: amt });
  }
  return out;
}
const team = (key, name, n, scale, raised, goal, extra) => {
  const r = rows(n, scale);
  const p = M.pace({ key, name, raised, goal, asOf, measure: key === 'grants' ? 'awarded' : 'raised' });
  const month = (k) => r.filter((x) => x.date.slice(0, 7) === k).reduce((s, x) => s + x.amount, 0);
  return M.weeklyHighlight({ key, name, asOf, rows: r, rowsFrom: '2026-08-01', pace: p, monthSoFar: key === 'grants' ? null : month('2026-10'), lastMonthTotal: key === 'grants' ? null : month('2026-09'), noun: key === 'grants' ? 'grant payment' : 'gift', ...(extra || {}) });
};
const grants = { awarded: 2580000, count: 41, received: 1910000, toCome: 670000, open: 9, thisMonth: { awards: 2, awarded: 85000 }, lastMonth: { awards: 5, awarded: 240000 }, enteredThrough: '2026-10-10' };
const overall = team('year', 'All of Favor', 900, 30000, 9763046.56, 13000000);
const teams = [
  team('rdd', 'RDD team', 260, 25000, 4290000, 4850000),
  team('grants', 'Grants', 30, 60000, 2580000, 3000000, { grants }),
  team('pc', 'Partner Care', 420, 2500, 281000, 360000),
  team('ce', 'Church Engagement', 140, 6000, 238000, 371000),
];
process.stdout.write(JSON.stringify({ ok: true, asOf, lastUpdated: '2026-10-14T21:11:19.000Z', giftsAvailable: true, teams: [], pace: {}, highlights: { week: { from: overall.from, to: overall.to }, overall, teams } }));
