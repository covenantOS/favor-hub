#!/usr/bin/env node
// Drafts changelog entries from the favor-hub commits made since the newest entry in src/content/changelog.
// Writes src/content/changelog/<day>.draft.md per day (the site ignores *.draft.md). A person or agent then
// rewrites each line for staff (plain sentences, "you can ...", no tool or vendor names, partners not donors, no names),
// fixes the area and kind, and renames the file to <day>.md (or merges it into an existing day file).
//
//   node scripts/changelog-draft.mjs            draft from origin/main
//   node scripts/changelog-draft.mjs --shots    also screenshot each changed area on the live site as the test user
//                                               (scripts/changelog-shots.mjs, data blurred) and attach the pictures
//   node scripts/changelog-draft.mjs --since 2026-10-14T12:00
//
// Every deploy adds a changelog entry with a picture. Run this with --shots after the deploy is live.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src/content/changelog');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };

/** The newest entry already written, as YYYY-MM-DDTHH:MM Eastern. */
export function latestStamp() {
  let latest = '';
  for (const f of readdirSync(DIR).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))) {
    const day = f.slice(0, 10);
    for (const m of readFileSync(join(DIR, f), 'utf8').matchAll(/time:\s*"?(\d{2}:\d{2})/g)) {
      const s = `${day}T${m[1]}`;
      if (s > latest) latest = s;
    }
  }
  return latest;
}

const INTERNAL = /^(merge|wip|test|tests|lint|refactor|chore|ci|build|bump|revert|typecheck|mock|baseline|harness|agent|docs?\b)|\b(tests?|vitest|lint|refactor|baseline|harness|mock|typecheck|e2e)\b/i;

// Path or subject words to a changelog area (src/content.config.ts CHANGE_AREAS). First match wins.
const AREA_RULES = [
  ['meetings', /meet|booking|room|huddle/i], ['clips', /clip/i], ['chat', /chat|channel/i], ['mail', /\bmail\b|gmail|inbox/i],
  ['brain', /brain|ask-favor/i], ['projects', /project|asana|task/i], ['learn', /learn|course|lesson/i], ['onboarding', /onboard|welcome/i],
  ['evaluations', /evaluation|evals?\b/i], ['expenses', /expense|mileage/i], ['receipts', /receipt|thank-you|thankyou/i],
  ['gifts', /gift-entry|online-gift|gift entry|online gifts|deposit/i], ['statements', /statement/i], ['foundations', /foundation/i],
  ['requests', /request|board/i], ['lists', /\blists?\b|credit|assignment/i], ['reporting', /report|kpi|dashboard|highlight/i],
  ['work-center', /work center|work-center|\bwc\b|cadence|work\//i], ['partners', /partner/i], ['admin', /admin|settings|audit/i],
  ['help', /help|tour|changelog|docs/i], ['phone', /phone|lite|data saver|mobile|ios/i], ['today', /today|bell|briefing/i],
];

function areaOf(subject, files) {
  const hay = subject + ' ' + files.join(' ');
  for (const [a, re] of AREA_RULES) if (re.test(hay)) return a;
  return 'everywhere';
}

function typeOf(subject) {
  if (/\bfix|broken|bug|no longer|again\b/i.test(subject)) return 'fixed';
  if (/\b(add|new|introduc|launch|first)\b/i.test(subject)) return 'new';
  return 'improved';
}

function commits(since) {
  const git = (a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
  try { git(['fetch', '-q', 'origin']); } catch { /* offline: use what is here */ }
  const log = git(['log', 'origin/main', '--no-merges', `--since=${since}:00 -0400`, '--date=format:%Y-%m-%dT%H:%M', '--format=@@%H|%ad|%s', '--name-only']);
  return log.split('@@').filter(Boolean).map((block) => {
    const [head, ...files] = block.trim().split('\n');
    const [sha, at, ...s] = head.split('|');
    return { sha, at, subject: s.join('|'), files: files.filter(Boolean) };
  }).filter((c) => c.at > since);
}

async function main() {
  const since = opt('--since') || latestStamp() || '2026-04-28T00:00';
  const list = commits(since);
  if (!list.length) { console.log('No commits since ' + since); return; }
  const days = new Map();
  for (const c of list) {
    const day = c.at.slice(0, 10);
    if (!days.has(day)) days.set(day, { entries: [], behind: 0 });
    const d = days.get(day);
    if (INTERNAL.test(c.subject)) { d.behind++; continue; }
    d.entries.push({ time: c.at.slice(11, 16), area: areaOf(c.subject, c.files), type: typeOf(c.subject), text: c.subject, sha: c.sha.slice(0, 8) });
  }
  if (args.includes('--shots')) {
    const { shoot, saveMap } = await import('./changelog-shots.mjs');
    const areas = [...new Set([...days.values()].flatMap((d) => d.entries.map((e) => e.area)))];
    const found = await shoot(areas);
    saveMap(found);
    for (const [day, d] of days) {
      const dir = join(ROOT, 'public/changelog', day);
      mkdirSync(dir, { recursive: true });
      for (const e of d.entries) {
        const f = found[e.area];
        if (!f) continue;
        for (const k of ['desk', 'phone']) {
          if (!f[k]) continue;
          const name = `${e.area}-${k}.webp`;
          if (!existsSync(join(dir, name))) copyFileSync(join(ROOT, 'public', f[k]), join(dir, name));
        }
        e.image = `/changelog/${day}/${e.area}-desk.webp`;
        if (f.phone) e.phone = `/changelog/${day}/${e.area}-phone.webp`;
      }
    }
  }
  for (const [day, d] of days) {
    d.entries.sort((a, b) => b.time.localeCompare(a.time));
    const y = ['---', `date: "${day}"`, 'entries:'];
    for (const e of d.entries) {
      y.push(`  # ${e.sha} REWRITE FOR STAFF: ${e.text.replace(/\n/g, ' ')}`);
      y.push(`  - time: "${e.time}"`, `    area: ${e.area}`, `    type: ${e.type}`, `    text: ${JSON.stringify(e.text)}`);
      if (e.image) y.push(`    image: ${e.image}`);
      if (e.phone) y.push(`    phone: ${e.phone}`);
    }
    if (!d.entries.length) y[y.length - 1] = 'entries: []';
    y.push(`behind: ${d.behind}`, '---', '');
    const out = join(DIR, `${day}.draft.md`);
    writeFileSync(out, y.join('\n'));
    console.log(`${out}: ${d.entries.length} entries, ${d.behind} behind the scenes`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
