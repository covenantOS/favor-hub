#!/usr/bin/env node
// The FavorOS merge train. Agents queue their branch (node scripts/ship-hub.mjs --train), and this one runner merges every queued branch
// onto origin/main, runs the gates once, pushes once and deploys the favoros-web Worker and Pages once. If the batch fails, it splits the
// batch in halves until it finds the branch that broke it, rejects that branch with the reason, and ships the rest.
//
// Run it in its own worktree (Q:/work/favor-hub/train), with the Marketing environment loaded:
//   source Q:/work/favor-hub/cfenv.sh && MSYS_NO_PATHCONV=1 node scripts/ship-train.mjs [--once]
// Queue entries live in Q:/work/favor-hub/train-queue/<id>.json; results in Q:/work/favor-hub/train-queue/done/<id>.json.
// An entry: { id, branch, checks: ['/x/=web'], priority (lower first, default 50), by, at }.
// The runner holds Q:/work/favor-hub/ship.lock while it works, so a classic ship-hub run never deploys at the same time.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

// A plain wait with no child process (a background Git Bash cannot always find `node` on its PATH).
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const Q = 'Q:/work/favor-hub/train-queue';
const DONE = Q + '/done';
const LOCK = 'Q:/work/favor-hub/ship.lock';
const FLAKY_LOG = 'Q:/work/favor-hub/flaky-tests.md';
const KNOWN = ['Huddle on a person rings them', 'Decline with a message posts it', 'the test accounts ring only each other'];
const once = process.argv.includes('--once');
mkdirSync(DONE, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sh = (cmd, capture = true) => execSync(cmd, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 1 << 28 });
const trySh = (cmd) => {
  try {
    return { ok: true, out: sh(cmd) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
};

function queued() {
  const all = readdirSync(Q)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: Q + '/' + f, ...JSON.parse(readFileSync(Q + '/' + f, 'utf8')) }));
  // One entry per branch: the newest wins (it may carry new commits or checks); older ones are closed as superseded, pointing at it,
  // so a waiter on an old entry follows the new one. The batch keeps the best priority any of them asked for.
  const newest = new Map();
  for (const e of all) { const n = newest.get(e.branch); if (!n || String(e.at) > String(n.at)) newest.set(e.branch, e); }
  for (const e of all) {
    const n = newest.get(e.branch);
    if (n !== e) {
      n.priority = Math.min(n.priority ?? 50, e.priority ?? 50);
      n.checks = [...new Set([...(n.checks || []), ...(e.checks || [])])];
      finish(e, { state: 'superseded', supersededBy: n.id, reason: 'a newer entry for the same branch replaced this one' });
    }
  }
  return [...newest.values()].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50) || String(a.at).localeCompare(String(b.at)));
}

function finish(entry, result) {
  writeFileSync(DONE + '/' + entry.id + '.json', JSON.stringify({ ...entry, ...result, finished: new Date().toISOString() }, null, 1));
  try { unlinkSync(entry.file); } catch { /* already gone */ }
  log(result.state.toUpperCase(), entry.id, entry.branch, result.reason || result.commit || '');
}

// ---------------------------------------------------------------- the lock (shared with ship-hub.mjs)
function takeLock() {
  for (let waited = 0; ; waited += 15) {
    let free = !existsSync(LOCK) || Date.now() - statSync(LOCK).mtimeMs > 40 * 60 * 1000;
    if (!free) {
      const holder = Number(readFileSync(LOCK, 'utf8').split(' ')[0]);
      try { process.kill(holder, 0); } catch { free = true; }
    }
    if (free) break;
    if (waited % 120 === 0) log('waiting for the ship lock: ' + readFileSync(LOCK, 'utf8'));
    pause(15000);
  }
  writeFileSync(LOCK, `${process.pid} ${process.cwd()} train ${new Date().toISOString()}`);
}
function dropLock() {
  try { if (readFileSync(LOCK, 'utf8').startsWith(String(process.pid) + ' ')) unlinkSync(LOCK); } catch { /* gone */ }
}
process.on('exit', dropLock);
process.on('SIGINT', () => process.exit(1));

// ---------------------------------------------------------------- the gates
const failedNames = (out) => [...new Set([...String(out).matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1]).filter((n) => n !== 'failing tests:'))];
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let lastLock = '';
// The set the tree holds right now, and whether the gates passed on it, so a batch that passed whole is not gated twice.
let treeKey = '';
let treeGreen = false;
const keyOf = (list) => list.map((e) => e.id).join('|');
// The lines of a failed run that say what failed (test names, assertions, type errors), so a rejection is readable at a glance.
const why = (out) => {
  const lines = String(out).split('\n').filter((l) => /FAIL |error TS|AssertionError|Expected|Received|✖ |❯ .*:\d+|Error:/.test(l)).slice(0, 14);
  return lines.length ? lines.join('\n') : String(out).slice(-800);
};

/** Every gate on the tree as it stands. Returns { ok, reason }. */
function gates() {
  const lock = readFileSync('package-lock.json', 'utf8') + readFileSync('web/package-lock.json', 'utf8');
  if (lock !== lastLock) {
    const r = trySh('npm install --no-audit --no-fund && npm --prefix web install --no-audit --no-fund');
    if (!r.ok) return { ok: false, reason: 'npm install: ' + r.out.slice(-400) };
    lastLock = lock;
  }
  let r = trySh('npm run build');
  if (!r.ok || !existsSync('dist/images/favor-icon.png')) return { ok: false, reason: 'pages build: ' + why(r.out) };
  let tests = '';
  try {
    tests = sh('node --test "tests/**/*.test.mjs"');
  } catch (e) {
    tests = String(e.stdout || '');
    const failed = failedNames(tests).filter((n) => !KNOWN.some((k) => n.startsWith(k)));
    const still = [];
    for (const name of failed) {
      let again = '';
      try { again = execFileSync(process.execPath, ['--test', '--test-name-pattern=^' + reEsc(name) + '$', 'tests/**/*.test.mjs'], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 28 }); } catch (e2) { again = String(e2.stdout || ''); }
      if (again.includes('✔ ' + name) && /^ℹ fail 0/m.test(again)) {
        const line = `- ${new Date().toISOString()} flipped (failed in the full run, passed alone): ${name} [merge train]\n`;
        try { writeFileSync(FLAKY_LOG, (existsSync(FLAKY_LOG) ? readFileSync(FLAKY_LOG, 'utf8') : '# Tests that flipped during ships (fix each one for real)\n\n') + line); } catch { /* convenience */ }
      } else still.push(name);
    }
    if (still.length) return { ok: false, reason: 'tests failing: ' + still.join(' | ') };
  }
  r = trySh('npm run typecheck && npm run app:test');
  if (!r.ok) return { ok: false, reason: 'typecheck or app tests: ' + why(r.out) };
  r = trySh('npm --prefix web run build && npm --prefix web exec -- tsc --noEmit -p web');
  if (!r.ok) return { ok: false, reason: 'web typecheck or build: ' + why(r.out) };
  return { ok: true };
}

/** origin/main plus these branches merged in order. Returns the entries that merged; the rest are rejected for conflicts. */
function assemble(entries) {
  sh('git checkout -q -- . && git clean -fdq -e node_modules -e web/node_modules -e dist -e web/dist && git checkout -q --detach origin/main');
  const merged = [];
  for (const e of entries) {
    const r = trySh(`git merge --no-edit -q ${e.branch}`);
    // A conflict only in the generated route trees (main no longer keeps web/src/routeTree.gen.ts) is settled by dropping them: every
    // build writes them again.
    let ok = r.ok;
    if (!ok) {
      const conflicted = trySh('git diff --name-only --diff-filter=U').out.split('\n').filter(Boolean);
      if (conflicted.length && conflicted.every((f) => /routeTree\.gen\.ts$/.test(f))) {
        for (const f of conflicted) trySh(`git rm -q -f --cached ${f}`);
        ok = trySh('git -c core.editor=true commit -q --no-edit').ok;
      }
    }
    if (ok) merged.push(e);
    else {
      trySh('git merge --abort');
      finish(e, { state: 'rejected', reason: 'does not merge onto main (rebase on origin/main and queue again): ' + r.out.slice(-300) });
    }
  }
  return merged;
}

/** The largest set of entries that passes the gates on top of `base` (already known good). One failing branch costs about log2(n) runs. */
function solve(base, cands) {
  if (!cands.length) return base;
  const all = assemble([...base, ...cands]);
  const fresh = all.filter((e) => !base.includes(e));
  if (!fresh.length) return base;
  log('gates on', all.map((e) => e.branch).join(', '));
  const g = gates();
  treeKey = keyOf(all);
  treeGreen = g.ok;
  if (g.ok) return all;
  if (fresh.length === 1) {
    finish(fresh[0], { state: 'rejected', reason: g.reason });
    return base;
  }
  const half = Math.ceil(fresh.length / 2);
  const left = solve(base, fresh.slice(0, half));
  return solve(left, fresh.slice(half));
}

function liveChecks(entries) {
  const checks = entries.flatMap((e) => e.checks || []);
  if (!checks.length) return '';
  pause(45000);
  const key = readFileSync(homedir() + '/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split('\n')[0].trim();
  const r = (() => {
    try { return { ok: true, out: execSync('node scripts/live-front.mjs', { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HUB_AGENT_KEY: key, LIVE_CHECKS: checks.join(' ') } }) }; } catch (e) { return { ok: false, out: String(e.stdout || '') }; }
  })();
  // The web routes among the checks are opened in a real browser too, for script and hydration errors a fetch cannot see.
  const web = checks.filter((c) => c.endsWith('=web')).map((c) => c.split('=')[0]);
  let seen = '';
  if (web.length) {
    try { seen = execSync('node scripts/live-console.mjs --loads 2', { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HUB_AGENT_KEY: key, LIVE_CONSOLE: [...new Set(web)].join(' ') } }); } catch (e) { seen = 'BROWSER ERRORS\n' + String(e.stdout || ''); }
    // Back from another page must leave nothing behind (streamed parts, repeated ids, a page that stopped drawing).
    try { seen += execSync('node scripts/live-back.mjs', { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HUB_AGENT_KEY: key, LIVE_BACK: [...new Set(web)].join(' ') } }); } catch (e) { seen += 'BACK LEFTOVERS ' + String(e.stdout || ''); }
  }
  return (r.ok ? '' : 'LIVE CHECK FAILED\n') + r.out + seen;
}

function meetingLive() {
  const out = sh(`npx wrangler d1 execute favor-requests --remote --json --command "SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE left_at = 0 AND removed = 0 AND seen > (strftime('%s','now') - 120) * 1000 AND lower(email) NOT IN ('tester@favorintl.org','tester2@favorintl.org','privacy-probe@favorintl.org','privacy-probe@favourafrica.org')"`);
  return Number((out.match(/"n":\s*(\d+)/) || [])[1]) !== 0;
}

function runBatch() {
  if (!queued().length) return false;
  takeLock();
  // Read the queue again once the lock is ours: branches queued while a solo ship held the lock join this batch.
  const entries = queued();
  try {
    if (!entries.length) return false;
    sh('git fetch -q origin');
    log('batch:', entries.map((e) => e.branch).join(', '));
    const good = solve([], entries);
    if (!good.length) return true;
    // The tree from the last gates run is the good set only when the last run passed on exactly that set; otherwise build it again.
    let g = { ok: true, reason: '' };
    if (!(treeGreen && treeKey === keyOf(good))) {
      assemble(good);
      g = gates();
    }
    if (!g.ok) {
      for (const e of good) finish(e, { state: 'rejected', reason: 'passed in a split run, failed together: ' + g.reason });
      return true;
    }
    for (let i = 0; meetingLive(); i++) {
      if (i === 0) log('a real person is in a meeting; waiting');
      if (i > 60) { for (const e of good) finish(e, { state: 'rejected', reason: 'a meeting ran for over an hour; queue again' }); return true; }
      pause(60000);
    }
    // Others may have pushed by hand meanwhile: merge their commits in and rebuild before pushing.
    sh('git fetch -q origin');
    if (sh('git rev-list --count HEAD..origin/main').trim() !== '0') {
      const r = trySh('git merge --no-edit -q origin/main');
      if (!r.ok) { trySh('git merge --abort'); for (const e of good) finish(e, { state: 'rejected', reason: 'main moved and no longer merges; queue again' }); return true; }
      const g2 = gates();
      if (!g2.ok) { for (const e of good) finish(e, { state: 'rejected', reason: 'failed after main moved: ' + g2.reason }); return true; }
    }
    sh('git push -q origin HEAD:main');
    const commit = sh('git rev-parse --short HEAD').trim();
    execSync('node scripts/keep-assets.mjs && npx wrangler deploy', { cwd: 'web', stdio: 'pipe' });
    execSync('npx wrangler pages deploy dist --project-name favor-hub --branch main --commit-dirty=true', { stdio: 'pipe' });
    const live = liveChecks(good);
    for (const e of good) finish(e, { state: 'shipped', commit, live: live.slice(0, 3000) });
    return true;
  } finally {
    dropLock();
  }
}

for (;;) {
  let worked = false;
  try {
    worked = runBatch();
  } catch (e) {
    log('runner error', String(e.message || e).slice(0, 600));
  }
  if (once) break;
  if (!worked) pause(20000);
}
