// Runs one report on the live hub and prints its tie-out line.
//   node scripts/reports-equiv.mjs status
//   node scripts/reports-equiv.mjs ytd-income mode=month
// Needs AGENT_API_KEY in the environment. Reads only.
const [id, ...pairs] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node scripts/reports-equiv.mjs <report id> [filter=value ...]');
  process.exit(2);
}
const key = process.env.AGENT_API_KEY;
if (!key) {
  console.error('Set AGENT_API_KEY first.');
  process.exit(2);
}
const q = new URLSearchParams(pairs.map((p) => p.split('=')));
const res = await fetch(`https://dash.favorintl.org/api/reports/${id}?${q}`, { headers: { Authorization: `Bearer ${key}` } });
const d = await res.json();
if (!d.ok) {
  console.error(d.error, d.message);
  process.exit(1);
}
const r = d.report;
const t = r.tie;
console.log(`${r.name}: ${r.count} rows, as of ${r.asOf}`);
console.log(`Totals: ${JSON.stringify(r.totals)}`);
console.log(`Tie-out: ${t.status}${t.label ? ` (${t.label}: this report ${t.mine}, KPI ${t.kpi}${t.diff ? `, differs by ${t.diff}` : ''})` : ''}`);
process.exit(t.status === 'differs' ? 1 : 0);
