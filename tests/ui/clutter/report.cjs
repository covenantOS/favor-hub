// Markdown report from the consensus grades: screens ranked by clutterShare, then
// every red and orange item. With a second round it adds a before and after column.
//
//   node tests/ui/clutter/report.cjs <round> [<later round>] > report.md
const fs = require('fs');
const path = require('path');
const { OUT } = require('./grade.cjs');

function load(round) {
  const dir = path.join(OUT, round);
  const out = {};
  for (const id of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, id, 'grades', 'consensus.json');
    if (fs.existsSync(p)) out[id] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return out;
}
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const [r1, r2] = process.argv.slice(2);
if (!r1) throw new Error('usage: report.cjs <round> [<later round>]');
const before = load(r1), after = r2 ? load(r2) : null;
const ids = Object.keys(before).sort((a, b) => before[b].metrics.clutterShare - before[a].metrics.clutterShare);
const mean = (g) => { const v = Object.values(g).map((x) => x.metrics.clutterShare); return v.length ? Math.round((10 * v.reduce((s, x) => s + x, 0)) / v.length) / 10 : 0; };

const L = [];
L.push(`# Hub clutter report: ${r1}${r2 ? ` and ${r2}` : ''}`, '');
L.push(`Protocol: ${Object.values(before)[0]?.protocol}. Prompt ${Object.values(before)[0]?.prompt}. clutterShare = red % + half of orange %, as a share of the drawn area.`, '');
L.push(`Screens graded: ${ids.length}. Mean clutterShare ${r1}: ${mean(before)}%${after ? `, ${r2}: ${mean(Object.fromEntries(Object.entries(after).filter(([k]) => before[k])))}%` : ''}.`, '');
L.push(after ? `| Screen | Device | ${r1} | ${r2} | Red | Orange | Score ${r1} | Score ${r2} |` : '| Screen | Device | clutterShare | Red | Orange | Score | Haiku agreed |');
L.push(after ? '|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|');
const n = (g, label) => (g ? g.regions.filter((r) => r.label === label).length : '');
for (const id of ids) {
  const b = before[id], a = after && after[id];
  if (after) L.push(`| ${cell(b.name)} | ${b.device} | ${b.metrics.clutterShare}% | ${a ? a.metrics.clutterShare + '%' : 'not graded'} | ${n(b, 'red')} to ${n(a, 'red')} | ${n(b, 'orange')} to ${n(a, 'orange')} | ${b.clutter_score} | ${a ? a.clutter_score : ''} |`);
  else L.push(`| ${cell(b.name)} | ${b.device} | ${b.metrics.clutterShare}% | ${n(b, 'red')} | ${n(b, 'orange')} | ${b.clutter_score} | ${b.consensus.haikuAgreed ? 'yes' : 'no, Sonnet'} |`);
}
for (const [label, g] of [[r1, before], ...(after ? [[r2, after]] : [])]) {
  L.push('', `## Every red and orange item, ${label}`, '', '| Screen | Device | Element text | Label | Type | Reason | Fix |', '|---|---|---|---|---|---|---|');
  for (const id of Object.keys(g).sort((x, y) => g[y].metrics.clutterShare - g[x].metrics.clutterShare))
    for (const r of g[id].regions) L.push(`| ${cell(g[id].name)} | ${g[id].device} | ${cell(r.text || r.name)} | ${r.label} | ${r.type} | ${cell(r.reason)} | ${cell(r.fix)} |`);
  L.push('', `## Missing information and defects, ${label}`, '');
  for (const id of Object.keys(g).sort()) {
    const x = g[id];
    for (const m of x.missing) L.push(`- ${x.name} (${x.device}), missing: ${cell(m.what)}. ${cell(m.why)}`);
    for (const d of x.defects) L.push(`- ${x.name} (${x.device}), defect: ${cell(d)}`);
  }
}
console.log(L.join('\n'));
