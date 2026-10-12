// Grade each shot screen for clutter with a cheap model through the claude CLI
// (subscription sign-in, no API key), the way ClutterBench's scripts/grade.cjs does.
// Writes <out>/<round>/<screen>__<device>/grades/<grader>.json.
//
//   node tests/ui/clutter/grade.cjs <round> --grader haiku-a [--only substr] [--ids a,b] [--concurrency 5] [--force]
//
// CLUTTER_OUT  folder that shoot.py wrote to (default Q:\Temp\Will\hub-agents-2026-10-11\clutter)
// CLAUDE_BIN   the claude executable, when it is not in one of the usual places
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.env.CLUTTER_OUT || 'Q:\\Temp\\Will\\hub-agents-2026-10-11\\clutter';
const PROMPT = 'hub_grader_v1.md';

// ClutterBench's official protocol: two Haiku passes at low effort, Sonnet at low effort where they differ.
const GRADERS = {
  'haiku-a': { model: 'claude-haiku-5-5', effort: 'low' },
  'haiku-b': { model: 'claude-haiku-5-5', effort: 'low' },
  sonnet: { model: 'claude-sonnet-5-5', effort: 'low' },
};

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}

function claudeBin() {
  const home = os.homedir();
  const tries = [process.env.CLAUDE_BIN, path.join(home, '.local/bin/claude.exe'), path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude.exe'), path.join(home, '.claude/local/claude')];
  return tries.find((p) => p && fs.existsSync(p)) || 'claude';
}

function elementLines(elements) {
  return elements
    .map((e) => `${e.id} ${e.kind} ${e.x},${e.y},${e.w},${e.h}${e.fontSize ? ` ${e.fontSize}px` : ''}${e.text ? ` "${e.text}"` : ''}`)
    .join('\n');
}

// The prompt goes in on stdin: a busy screen's element list is longer than a Windows command line allows.
function callClaude(g, prompt, cwd) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if ((/^CLAUDE/.test(k) && k !== 'CLAUDE_CODE_GIT_BASH_PATH') || /^ANTHROPIC_/.test(k)) delete env[k];
    const child = spawn(claudeBin(),
      ['-p', '--model', g.model, '--effort', g.effort, '--dangerously-skip-permissions', '--setting-sources', '',
        '--strict-mcp-config', '--tools', 'Read', '--output-format', 'json'],
      { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 6 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const d = JSON.parse(out);
        if (d.is_error) return reject(new Error(`grader error: ${String(d.result).slice(0, 200)}`));
        const u = d.usage || {};
        resolve({ text: d.result, usd: d.total_cost_usd, tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0), outputTokens: u.output_tokens });
      } catch (e) {
        reject(new Error(`grader exit ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
  });
}

function parseJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('no JSON in grader reply');
  return JSON.parse(text.slice(s, e + 1));
}

// "e12-e19" means every id from e12 to e19.
function expandIds(ids, known) {
  const out = [];
  for (const raw of ids || []) {
    const m = /^e(\d+)\s*-\s*e?(\d+)$/.exec(String(raw).trim());
    if (m) { for (let i = Number(m[1]); i <= Number(m[2]) && i - Number(m[1]) < 2000; i++) out.push(`e${i}`); } else out.push(String(raw).trim());
  }
  return out.filter((x) => known.has(x));
}

// Paint labels onto a coarse grid: containers first, leaf marks on top.
// A container contributes only its border ring, so a card's empty interior
// counts for nothing. Shares are of painted pixels: blank screen is not rewarded.
// Same as ClutterBench; an element the grader left out counts as blue.
function areaShares(elements, labelOf, canvas) {
  const S = 4, gw = Math.ceil(canvas.w / S), gh = Math.ceil(canvas.h / S);
  const grid = new Uint8Array(gw * gh);
  const code = { blue: 1, orange: 2, red: 3 };
  const order = [...elements].sort((a, b) => (a.kind === 'box') === (b.kind === 'box') ? b.w * b.h - a.w * a.h : a.kind === 'box' ? -1 : 1);
  for (const e of order) {
    const c = code[labelOf[e.id] || 'blue'] || 1;
    const x0 = Math.floor(e.x / S), y0 = Math.floor(e.y / S);
    const x1 = Math.min(gw, Math.ceil((e.x + e.w) / S)), y1 = Math.min(gh, Math.ceil((e.y + e.h) / S));
    const ring = e.kind === 'box' ? 2 : Infinity;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (x - x0 < ring || x1 - 1 - x < ring || y - y0 < ring || y1 - 1 - y < ring) grid[y * gw + x] = c;
  }
  const n = [0, 0, 0, 0];
  for (const v of grid) n[v]++;
  const painted = n[1] + n[2] + n[3] || 1;
  const pct = (v) => Math.round((1000 * v) / painted) / 10;
  return { blue: pct(n[1]), orange: pct(n[2]), red: pct(n[3]), paintedOfCanvas: Math.round((1000 * painted) / grid.length) / 10 };
}

const clutterShare = (shares) => Math.round((shares.red + shares.orange / 2) * 10) / 10;

function buildPrompt(dir, meta, canvas, elements) {
  const scope = meta.root === '#h-content' && !meta.overlay
    ? `The element list covers the page body only. The hub's menu and top bar around it are graded as a separate screen: do not label them, but use what you see there to spot repetition. The top bar reads "${meta.topBarTitle}".`
    : meta.overlay
      ? 'The element list covers the open panel or view named above. Anything else in the screenshot sits behind it and is graded elsewhere.'
      : 'The element list covers the hub menu, the top bar and the phone tab bar. The page body between them is graded as its own screen.';
  return fs.readFileSync(path.join(__dirname, PROMPT), 'utf8')
    .replace('{{SHOT}}', path.join(dir, 'shot.png'))
    .replace('{{NAME}}', meta.name).replace('{{DEVICE}}', meta.device).replace('{{JOB}}', meta.job).replace('{{SCOPE}}', scope)
    .replace('{{W}}', canvas.w).replace('{{H}}', canvas.h)
    .replace('{{ELEMENTS}}', elementLines(elements));
}

async function gradeOne(round, id, name, force) {
  const g = GRADERS[name];
  const dir = path.join(OUT, round, id);
  const outPath = path.join(dir, 'grades', `${name}.json`);
  if (!fs.existsSync(path.join(dir, 'elements.json'))) return;
  if (fs.existsSync(outPath) && !force) return;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const { canvas, elements, stats } = JSON.parse(fs.readFileSync(path.join(dir, 'elements.json'), 'utf8'));
  if (!elements.length) return console.error('SKIP', id, 'no elements');
  const prompt = buildPrompt(dir, meta, canvas, elements);
  let raw, parsed, cost;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const t0 = Date.now();
      raw = await callClaude(g, prompt, dir);
      cost = { seconds: Math.round((Date.now() - t0) / 100) / 10, usd: raw.usd ?? null, tokens: raw.tokens ?? null, outputTokens: raw.outputTokens ?? null };
      parsed = parseJson(raw.text);
    } catch (e) {
      if (attempt === 1 || /limit/i.test(e.message)) return console.error('FAIL', id, name, e.message.slice(0, 200));
    }
  }
  const known = new Set(elements.map((e) => e.id));
  const textOf = Object.fromEntries(elements.map((e) => [e.id, e.text || '']));
  const labelOf = {};
  const regions = (parsed.regions || []).filter((r) => r.label === 'orange' || r.label === 'red').map((r, i) => {
    const ids = expandIds(r.ids, known).filter((x) => !labelOf[x]);
    for (const x of ids) labelOf[x] = r.label;
    const text = ids.map((x) => textOf[x]).filter(Boolean).join(' | ').slice(0, 300) || r.text || '';
    return { rid: `r${i}`, label: r.label, type: r.type, name: r.name || '', text, reason: r.reason || '', fix: r.fix || '', ids };
  }).filter((r) => r.ids.length);
  const shares = areaShares(elements, labelOf, canvas);
  const grade = {
    grader: name, model: g.model, effort: g.effort, prompt: PROMPT, gradedAt: new Date().toISOString(),
    main_job: parsed.main_job, ideas: parsed.ideas || [], clutter_score: parsed.clutter_score, summary: parsed.summary,
    missing: (parsed.missing || []).map((m, i) => ({ mid: `m${i}`, what: m.what || '', why: m.why || '' })),
    completeness_score: parsed.completeness_score ?? null,
    defects: parsed.defects || [],
    cost,
    regions,
    metrics: {
      shares,
      // headline: share of drawn area that is clutter (orange counts half)
      clutterShare: clutterShare(shares),
      ideaCount: (parsed.ideas || []).length,
      missingCount: (parsed.missing || []).length,
      redByType: regions.filter((r) => r.label === 'red').reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + 1), m), {}),
      words: stats.words, textElements: stats.textElements,
    },
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(grade, null, 1) + '\n');
  console.log(id, name, `clutter=${grade.metrics.clutterShare}%`, `score=${grade.clutter_score}`, `regions=${regions.length}`, `missing=${grade.metrics.missingCount}`, `${cost.seconds}s`);
}

async function main() {
  const round = process.argv[2];
  const name = arg('grader', 'haiku-a');
  if (!round || round.startsWith('--')) throw new Error('usage: grade.cjs <round> --grader haiku-a');
  if (!GRADERS[name]) throw new Error(`unknown grader ${name}; have ${Object.keys(GRADERS)}`);
  const only = arg('only');
  const force = process.argv.includes('--force');
  const exact = arg('ids') ? new Set(arg('ids').split(',')) : null;
  const ids = fs.readdirSync(path.join(OUT, round)).filter((id) => (!only || only.split(',').some((o) => id.includes(o))) && (!exact || exact.has(id))).sort();
  let i = 0;
  await Promise.all(Array.from({ length: Number(arg('concurrency', 5)) }, async () => {
    while (i < ids.length) await gradeOne(round, ids[i++], name, force);
  }));
}
module.exports = { areaShares, clutterShare, OUT };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
