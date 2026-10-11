// Runs lintapple against the live hub, signed in as an admin, at phone, iPad and desktop size.
// Every page in src/data/areas.ts is reached by clicking from Today. The main overlays are opened and checked too.
// Read only: write requests are stopped at the network. Never run against a URL you do not own.
//
//   HUB_COOKIES=<saved cookie json> npm run lint:ui                 fail on anything worse than tests/ui/baseline.json
//   npm run lint:ui:all                                              fail on every finding
//   npm run lint:ui:baseline                                         record today's findings as the baseline
//   HUB_URL=https://<branch>.favor-hub-d4n.pages.dev npm run lint:ui check a preview
// Options (env): HUB_PROFILES=phone,ipad,desktop  HUB_ONLY=<nav ids, comma separated>  HUB_OUT=<report folder>
// Exit codes: 0 pass, 1 findings, 2 the sweep could not finish.
import { checkPage, validatePolicy } from 'lintapple';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AREAS } from '../../src/data/areas.ts';
import { BASE, HERE, ROOT, PROFILES, loadCookies, launch, newSession, openToday, ready, gotoByClicking, clickFirst } from './lib.mjs';

const args = new Set(process.argv.slice(2));
const MODE = args.has('--all') ? 'all' : args.has('--write-baseline') ? 'write' : 'baseline';
const profileNames = (process.env.HUB_PROFILES || 'phone,ipad,desktop').split(',').map((s) => s.trim()).filter(Boolean);
const only = process.env.HUB_ONLY ? new Set(process.env.HUB_ONLY.split(',')) : null;
const OUT = process.env.HUB_OUT || join(ROOT, '.ui-report');
const BASELINE = join(HERE, 'baseline.json');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const basePolicy = await readJson(join(ROOT, 'ui-policy.json'));
const overrides = await readJson(join(HERE, 'profiles.json'));
function policyFor(name) {
  const o = overrides[name] || {};
  return validatePolicy({ ...basePolicy, ...o, typeRules: [...(o.typeRules || []), ...basePolicy.typeRules], controlSizeRules: [...(o.controlSizeRules || []), ...basePolicy.controlSizeRules] });
}

// Pages: every non-external page in areas.ts.
const targets = [];
for (const area of AREAS) for (const pg of area.pages) if (!pg.ext && (!only || only.has(pg.id))) targets.push({ area, pg });

// Overlays: opened from a page, checked, then the next one starts again from Today.
const overlays = [
  { id: 'overlay:search', from: 'home', open: (p) => clickFirst(p, '[data-cmdk-open]') },
  { id: 'overlay:help', from: 'home', open: (p) => clickFirst(p, '#lp-btn') },
  { id: 'overlay:more-sheet', from: 'home', open: (p) => clickFirst(p, '#h-bar-more') },
  { id: 'overlay:bell', from: 'home', open: (p) => clickFirst(p, '#wm-bell') },
  { id: 'overlay:request-drawer', from: 'board', open: (p) => clickFirst(p, '.req-card') },
  { id: 'overlay:huddle-sheet', from: 'chat', open: async (p) => {
    // On a phone the channel list shows first. Open a channel, then the huddle button. The sheet's own Join and Start buttons are never pressed.
    if (!(await p.locator('.ch-btn--meet').filter({ visible: true }).count())) { await clickFirst(p, '.ch-row[data-act="open"]'); await p.waitForTimeout(1200); }
    return clickFirst(p, '.ch-btn--meet');
  } },
].filter((o) => !only || only.has(o.id) || only.has(o.from));

// Describe the elements behind a list of selectors so the report can group them by kind.
async function describe(frame, selectors) {
  return frame.evaluate((sels) => sels.map((s) => {
    let el = null;
    try { el = document.querySelector(s); } catch { /* bad selector */ }
    if (!el) return { kind: '?', text: '' };
    const cls = [...el.classList].filter((c) => !/^(is|has)-/.test(c)).slice(0, 2).join('.');
    const r = el.getBoundingClientRect();
    return { kind: el.tagName.toLowerCase() + (cls ? '.' + cls : ''), text: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40), box: `${Math.round(r.width)}x${Math.round(r.height)}` };
  }), selectors);
}

async function runCheck(frame, policy) {
  const report = await checkPage(frame, policy);
  const info = await describe(frame, report.findings.map((f) => f.selector));
  return report.findings.map((f, i) => ({ rule: f.rule === 'text-contrast' && /could not be measured/.test(f.message) ? 'text-contrast-unmeasurable' : f.rule, selector: f.selector, message: f.message, fix: f.fix, ...info[i] }));
}

async function sweepProfile(name, browser, cookies) {
  const policy = policyFor(name);
  const blocked = [];
  const { context, page } = await newSession(browser, name, cookies, blocked);
  const results = [];
  const notes = [];
  const baseKeys = new Map();
  const record = async (id, how, frame, tag) => {
    const findings = await runCheck(frame, policy);
    results.push({ profile: name, page: id + (tag || ''), how, findings });
    return findings;
  };
  const sweepPage = async (id, how) => {
    const f = await record(id, how, page);
    baseKeys.set(id, new Set(f.map((x) => x.rule + '|' + x.selector)));
    // The KPI dashboard draws its pages inside a frame. Check the frame's own document too.
    const kpi = await page.locator('iframe#kpi-frame').count() ? await (await page.locator('iframe#kpi-frame').elementHandle()).contentFrame() : null;
    // The KPI frame needs a Google sign-in on its own origin path, so the saved admin cookie gets its sign-in page. Skip it then.
    if (kpi && !/Sign in to the hub/.test(await kpi.evaluate(() => document.body.innerText).catch(() => ''))) {
      await kpi.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await record(id, how, kpi, ' (frame)').catch((e) => notes.push(`${name} ${id} frame: ${e.message.split('\n')[0]}`));
    }
  };

  for (const { area, pg } of targets) {
    try {
      await openToday(page);
      let how;
      try { how = await gotoByClicking(page, area, pg.id); }
      catch (e) { await page.goto(BASE + pg.href, { waitUntil: 'domcontentloaded' }); await ready(page); how = 'direct (' + e.message + ')'; }
      await sweepPage(pg.id, how);
      console.log(`${name} ${pg.id}: ${results.filter((r) => r.page.startsWith(pg.id) && r.profile === name).reduce((n, r) => n + r.findings.length, 0)}`);
    } catch (e) {
      if (/Signed out/.test(e.message)) throw e;
      notes.push(`${name} ${pg.id}: ${e.message.split('\n')[0]}`);
    }
  }

  for (const ov of overlays) {
    try {
      await openToday(page);
      const from = targets.find((t) => t.pg.id === ov.from);
      if (from && ov.from !== 'home') await gotoByClicking(page, from.area, ov.from);
      const base = new Set((baseKeys.get(ov.from) || []));
      if (!(await ov.open(page))) { notes.push(`${name} ${ov.id}: control not visible at this size`); continue; }
      await page.waitForTimeout(1300);
      const findings = (await runCheck(page, policy)).filter((x) => !base.has(x.rule + '|' + x.selector));
      results.push({ profile: name, page: ov.id, how: 'opened from ' + ov.from, findings });
      console.log(`${name} ${ov.id}: ${findings.length}`);
    } catch (e) {
      if (/Signed out/.test(e.message)) throw e;
      notes.push(`${name} ${ov.id}: ${e.message.split('\n')[0]}`);
    }
  }
  await context.close();
  return { results, notes, blocked: [...new Set(blocked)] };
}

function summarize(results) {
  const rules = new Map();
  for (const r of results) for (const f of r.findings) {
    const e = rules.get(f.rule) || { rule: f.rule, count: 0, places: new Set(), pages: new Map(), kinds: new Map(), example: null };
    e.count++;
    e.places.add(r.profile + '|' + r.page);
    const pk = r.page + ' @' + r.profile;
    e.pages.set(pk, (e.pages.get(pk) || 0) + 1);
    const kk = f.kind;
    const k = e.kinds.get(kk) || { n: 0, example: f };
    k.n++; e.kinds.set(kk, k);
    if (!e.example) e.example = { page: pk, ...f };
    rules.set(f.rule, e);
  }
  return [...rules.values()].sort((a, b) => b.places.size - a.places.size || b.count - a.count).map((e) => ({
    rule: e.rule, findings: e.count, places: e.places.size,
    worstPages: [...e.pages].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p} (${n})`),
    topElements: [...e.kinds].sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([kind, v]) => ({ kind, n: v.n, text: v.example.text, box: v.example.box, message: v.example.message })),
    example: e.example,
  }));
}

// A key per (rule, page, element kind) with a count. A change is a regression when a key is new or its count grew.
function keyCounts(results) {
  const m = {};
  for (const r of results) for (const f of r.findings) { const k = `${f.rule}|${r.profile}|${r.page}|${f.kind}`; m[k] = (m[k] || 0) + 1; }
  return m;
}

function markdown(summary, meta) {
  const L = [`# lintapple sweep`, '', `${meta.base}, ${meta.when}. Profiles: ${meta.profiles.join(', ')}. Pages checked: ${meta.pageRuns}. Total findings: ${meta.total}.`, ''];
  L.push('| Rule | Findings | Places failing | Worst pages | Example |', '| --- | ---: | ---: | --- | --- |');
  for (const s of summary) L.push(`| ${s.rule} | ${s.findings} | ${s.places} | ${s.worstPages.slice(0, 3).join('; ')} | ${s.example.kind} "${s.example.text}" ${s.example.message} |`);
  L.push('');
  for (const s of summary) {
    L.push(`## ${s.rule} (${s.findings} findings, ${s.places} places)`, '');
    for (const t of s.topElements) L.push(`- ${t.n} x ${t.kind}${t.text ? ` "${t.text}"` : ''} ${t.box || ''}: ${t.message}`);
    L.push(`- Fix: ${s.example.fix}`, '');
  }
  if (meta.notes.length) L.push('## Notes', '', ...meta.notes.map((n) => '- ' + n), '');
  if (meta.blocked.length) L.push('## Write requests stopped at the network', '', ...meta.blocked.map((n) => '- ' + n), '');
  return L.join('\n');
}

async function main() {
  const cookies = await loadCookies();
  const browser = await launch();
  let runs;
  try { runs = await Promise.all(profileNames.map((p) => sweepProfile(p, browser, cookies))); }
  finally { await browser.close(); }
  const results = runs.flatMap((r) => r.results);
  const total = results.reduce((n, r) => n + r.findings.length, 0);
  const summary = summarize(results);
  const meta = { base: BASE, when: new Date().toISOString(), profiles: profileNames, pageRuns: results.length, total, notes: runs.flatMap((r) => r.notes), blocked: [...new Set(runs.flatMap((r) => r.blocked))] };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'lintapple-report.json'), JSON.stringify({ meta, summary, results }, null, 1));
  await writeFile(join(OUT, 'lintapple-summary.md'), markdown(summary, meta));
  console.log(`\n${total} findings across ${results.length} page runs. Report: ${join(OUT, 'lintapple-summary.md')}`);
  for (const s of summary.slice(0, 12)) console.log(`${String(s.places).padStart(4)} places ${String(s.findings).padStart(5)} findings  ${s.rule}`);
  if (meta.notes.length) console.log(`${meta.notes.length} notes (pages or controls not reached), see the summary.`);
  if (!results.length) { console.error('Nothing was checked.'); process.exit(2); }

  const counts = keyCounts(results);
  if (MODE === 'write') {
    await writeFile(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 1) + '\n');
    console.log(`Baseline written: ${Object.keys(counts).length} keys.`);
    return;
  }
  if (MODE === 'all') process.exit(total ? 1 : 0);
  let base = {};
  try { base = await readJson(BASELINE); } catch { console.error('No tests/ui/baseline.json; every finding counts.'); }
  // Only the profiles and pages that ran are compared.
  const ranPages = new Set(results.map((r) => r.profile + '|' + r.page));
  // Live data changes row counts between runs, so a key may grow by 15% plus 2 before it counts as worse.
  const worse = Object.entries(counts).filter(([k, n]) => n > Math.ceil((base[k] || 0) * 1.15) + 2);
  const fixed = Object.keys(base).filter((k) => !(k in counts)).length;
  console.log(`Against the baseline: ${worse.length} worse, ${fixed} keys gone.`);
  void ranPages;
  for (const [k, n] of worse.slice(0, 40)) console.log(`  WORSE ${k}: ${n} (baseline ${base[k] || 0})`);
  process.exit(worse.length ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(2); });
