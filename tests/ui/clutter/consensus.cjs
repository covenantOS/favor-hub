// Consensus grade, ClutterBench's official protocol: two Haiku passes; where they
// differ in any way, Sonnet breaks the tie. Runs whichever passes are missing, then
// writes <out>/<round>/<screen>__<device>/grades/consensus.json.
//
// Per element the final label is the majority of the passes (Sonnet's label if all
// three differ). Scores take the median.
//
//   node tests/ui/clutter/consensus.cjs <round> [--only substr] [--concurrency 5]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { areaShares, clutterShare, OUT } = require('./grade.cjs');

const round = process.argv[2];
if (!round) throw new Error('usage: consensus.cjs <round>');
const pass = (name) => process.argv.slice(3).filter((a, i, all) => ['--only', '--concurrency'].includes(a) || ['--only', '--concurrency'].includes(all[i - 1]));
const A = 'haiku-a', B = 'haiku-b', T = 'sonnet';
const RUNS = path.join(OUT, round);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const read = (id, g) => {
  const p = path.join(RUNS, id, 'grades', `${g}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};
const labelMap = (g) => {
  const m = {};
  for (const r of g.regions) for (const id of r.ids) m[id] = r;
  return m;
};
const median = (v) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
const grade = (name, extra) => execFileSync('node', [path.join(__dirname, 'grade.cjs'), round, '--grader', name, ...pass(), ...extra], { stdio: 'inherit' });

function differs(a, b, elements) {
  const la = labelMap(a), lb = labelMap(b);
  const changed = elements.filter((e) => ((la[e.id] || {}).label || 'blue') !== ((lb[e.id] || {}).label || 'blue')).length;
  return { changed, any: changed > 0 || a.clutter_score !== b.clutter_score || (a.missing.length > 0) !== (b.missing.length > 0) };
}

grade(A, []);
grade(B, []);

const ids = fs.readdirSync(RUNS).filter((id) => fs.existsSync(path.join(RUNS, id, 'elements.json')) && (!only || only.some((o) => id.includes(o)))).sort();
const need = [];
for (const id of ids) {
  const a = read(id, A), b = read(id, B);
  if (!a || !b) { console.error('missing haiku pass:', id); continue; }
  const { elements } = JSON.parse(fs.readFileSync(path.join(RUNS, id, 'elements.json'), 'utf8'));
  if (differs(a, b, elements).any && !read(id, T)) need.push(id);
}
if (need.length) {
  console.log(`tiebreak needed on ${need.length} screens, calling ${T}`);
  grade(T, ['--ids', need.join(',')]);
}

let tie = 0, done = 0;
for (const id of ids) {
  const a = read(id, A), b = read(id, B);
  if (!a || !b) continue;
  const { elements, stats } = JSON.parse(fs.readFileSync(path.join(RUNS, id, 'elements.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(RUNS, id, 'meta.json'), 'utf8'));
  const d = differs(a, b, elements);
  const t = d.any ? read(id, T) : null;
  if (d.any && !t) { console.error('no tiebreak grade for', id); continue; }
  const passes = t ? [t, a, b] : [a]; // order = preference when picking a source region
  const maps = passes.map(labelMap);
  const labelOf = {}, groups = new Map();
  for (const e of elements) {
    const votes = maps.map((m) => (m[e.id] || {}).label || 'blue');
    const count = {};
    for (const v of votes) count[v] = (count[v] || 0) + 1;
    const top = Object.entries(count).sort((x, y) => y[1] - x[1])[0];
    const final = top[1] >= 2 || votes.length === 1 ? top[0] : votes[0];
    if (final === 'blue') continue;
    labelOf[e.id] = final;
    const src = maps.findIndex((m) => (m[e.id] || {}).label === final);
    const r = maps[src][e.id];
    const key = `${src}:${r.rid}`;
    if (!groups.has(key)) groups.set(key, { label: final, type: r.type, name: r.name, reason: r.reason, fix: r.fix, ids: [], texts: [] });
    groups.get(key).ids.push(e.id);
    if (e.text) groups.get(key).texts.push(e.text);
  }
  const regions = [...groups.values()].map(({ texts, ...r }, i) => ({ rid: `r${i}`, ...r, text: texts.join(' | ').slice(0, 300) }));
  const flagged = passes.filter((p) => p.missing.length > 0);
  const missing = flagged.length * 2 > passes.length ? flagged[0].missing : [];
  const shares = areaShares(elements, labelOf, meta.canvas);
  const out = {
    grader: 'consensus', protocol: `${A} + ${B} (claude-haiku-5-5, low), ${T} (claude-sonnet-5-5, low) tiebreak`, prompt: a.prompt, gradedAt: new Date().toISOString(),
    screen: meta.screen, name: meta.name, device: meta.device, url: meta.url, host: meta.host,
    consensus: { haikuAgreed: !d.any, elementsChanged: d.changed, tiebreak: !!t, scores: passes.map((p) => p.clutter_score) },
    main_job: passes[0].main_job, ideas: passes[0].ideas, summary: passes[0].summary,
    clutter_score: median(passes.map((p) => Number(p.clutter_score))),
    completeness_score: median(passes.map((p) => Number(p.completeness_score ?? 10))),
    missing, defects: [...new Set(passes.flatMap((p) => p.defects || []))],
    regions,
    metrics: {
      shares, clutterShare: clutterShare(shares),
      missingCount: missing.length,
      redByType: regions.filter((r) => r.label === 'red').reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + r.ids.length), m), {}),
      words: stats.words, textElements: stats.textElements,
      usd: Math.round(1000 * [a, b, t].filter(Boolean).reduce((s, p) => s + ((p.cost || {}).usd || 0), 0)) / 1000,
    },
  };
  fs.writeFileSync(path.join(RUNS, id, 'grades', 'consensus.json'), JSON.stringify(out, null, 1) + '\n');
  done++; if (t) tie++;
}
console.log(`consensus written for ${done} screens; Haiku passes agreed on ${done - tie}, Sonnet broke ties on ${tie}`);
