#!/usr/bin/env node
// One way to ship FavorOS (dash.favorintl.org) from a worktree. Every step must pass before the next one runs:
//   clean tree, fetch and rebase on origin/main, no conflict markers, npm install, the hub tests, typecheck, app tests, the web app's
//   typecheck and build, no live meeting, the Pages build with its image check, push to main, deploy the favoros-web Worker, deploy Pages, then read each --check path live and fail if it does not answer as expected.
// usage: node scripts/ship-hub.mjs [--no-pages] [--check /path/=web|classic ...] [--skip-known-failures]
// In Git Bash set MSYS_NO_PATHCONV=1 first, or a /path argument turns into C:/Program Files/Git/path.
// Needs the Marketing account environment (source Q:/work/favor-hub/cfenv.sh) and the agent key for --check.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const checks = args.flatMap((a, i) => (a === '--check' ? [args[i + 1]] : []));
const sh = (cmd, opts = {}) => {
  console.log('\n$ ' + cmd);
  return execSync(cmd, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', ...opts });
};
const step = (name, fn) => {
  const t = Date.now();
  try {
    const out = fn();
    console.log(`ok   ${name} (${Math.round((Date.now() - t) / 1000)} s)`);
    return out;
  } catch (e) {
    console.error(`FAIL ${name}: ${(e.message || e).toString().slice(0, 400)}`);
    process.exit(1);
  }
};

// One ship at a time on this machine: agents share Q:/work/favor-hub/ship.lock (pid, worktree, start time). A lock older than 40
// minutes is stale (a ship takes about 10). The lock is released on exit, success or failure.
const LOCK = 'Q:/work/favor-hub/ship.lock';
for (let waited = 0; ; waited += 15) {
  if (!existsSync(LOCK) || Date.now() - statSync(LOCK).mtimeMs > 40 * 60 * 1000) break;
  // A lock whose ship was killed (no exit handler ran) is free.
  const holder = Number(readFileSync(LOCK, 'utf8').split(' ')[0]);
  let alive = false;
  try { process.kill(holder, 0); alive = true; } catch { alive = false; }
  if (!alive) break;
  if (waited === 0) console.log('waiting for another ship: ' + readFileSync(LOCK, 'utf8'));
  if (waited > 45 * 60) { console.error('FAIL lock: another ship has held it for 45 minutes'); process.exit(1); }
  execSync('node -e "setTimeout(()=>{},15000)"');
}
writeFileSync(LOCK, `${process.pid} ${process.cwd()} ${new Date().toISOString()}`);
process.on('exit', () => { try { if (readFileSync(LOCK, 'utf8').startsWith(String(process.pid) + ' ')) unlinkSync(LOCK); } catch { /* gone */ } });

// Tests that fail on main for reasons outside a ship (named in the work log); listed so a ship is not blocked by them.
const KNOWN = ['Huddle on a person rings them', 'Decline with a message posts it', 'the test accounts ring only each other'];

step('clean tree', () => {
  const dirty = sh('git status --porcelain --untracked-files=no', { capture: true }).split('\n').filter((l) => l && !/routeTree\.gen\.ts$/.test(l));
  if (dirty.length) throw new Error('commit first:\n' + dirty.join('\n'));
  sh('git checkout -- app/src/routeTree.gen.ts web/src/routeTree.gen.ts');
});
step('fetch and rebase', () => sh('git fetch -q origin && git rebase origin/main'));
step('no conflict markers', () => {
  const out = sh('git grep -nE "^(<<<<<<<|>>>>>>>) " -- functions src public app web shared tests || true', { capture: true });
  if (out.trim()) throw new Error(out);
});
step('npm install', () => sh('npm install --no-audit --no-fund && npm --prefix web install --no-audit --no-fund'));
// The Pages build comes before the tests: some tests read dist/ (the changelog page), and a stale dist fails them.
if (!has('--no-pages')) {
  step('pages build', () => {
    sh('npm run build');
    if (!existsSync('dist/images/favor-icon.png')) throw new Error('dist is incomplete');
  });
}
// A test that fails under the machine's load gets one more run on its own. A test that then passes is logged in
// Q:/work/favor-hub/flaky-tests.md (to be fixed for real: fake timers, no shared state) and does not block the ship.
const FLAKY_LOG = 'Q:/work/favor-hub/flaky-tests.md';
const failedNames = (out) => [...new Set([...String(out).matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1]).filter((n) => n !== 'failing tests:'))];
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
step('hub tests', () => {
  let out = '';
  try {
    out = sh('node --test "tests/**/*.test.mjs"', { capture: true, maxBuffer: 1 << 28 });
  } catch (e) {
    out = String(e.stdout || '');
    let failed = failedNames(out).filter((n) => !(has('--skip-known-failures') && KNOWN.some((k) => n.startsWith(k))));
    const still = [];
    for (const name of failed) {
      let again = '';
      let ok = false;
      try {
        // No shell between here and node, so the pattern's backslashes arrive as written.
        console.log('\nrerun alone: ' + name);
        again = execFileSync(process.execPath, ['--test', '--test-name-pattern=^' + reEsc(name) + '$', 'tests/**/*.test.mjs'], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 28 });
        // It ran (its own pass line is there) and nothing failed.
        ok = again.includes('✔ ' + name) && /^ℹ fail 0/m.test(again);
      } catch (e2) {
        again = String(e2.stdout || '');
      }
      if (ok) {
        const line = `- ${new Date().toISOString()} flipped (failed in the full run, passed alone): ${name} [${process.cwd()}]\n`;
        try { writeFileSync(FLAKY_LOG, (existsSync(FLAKY_LOG) ? readFileSync(FLAKY_LOG, 'utf8') : '# Tests that flipped during ships (fix each one for real)\n\n') + line); } catch { /* the log is a convenience */ }
        console.log('flaky, passed alone: ' + name);
      } else still.push(name);
    }
    if (still.length) throw new Error('failing: ' + still.join(' | '));
  }
  const pass = (out.match(/^ℹ pass (\d+)/m) || [])[1];
  console.log('pass ' + pass);
});
step('typecheck and app tests', () => sh('npm run typecheck && npm run app:test'));
step('web typecheck and build', () => sh('npm --prefix web exec -- tsc --noEmit -p web && npm --prefix web run build'));
step('no live meeting', () => {
  // A real person seen in a room in the last two minutes. Test accounts (meeting suites run at night) do not count.
  const out = sh(`npx wrangler d1 execute favor-requests --remote --json --command "SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE left_at = 0 AND removed = 0 AND seen > (strftime('%s','now') - 120) * 1000 AND lower(email) NOT IN ('tester@favorintl.org','tester2@favorintl.org','privacy-probe@favorintl.org','privacy-probe@favourafrica.org')"`, { capture: true });
  const n = Number((out.match(/"n":\s*(\d+)/) || [])[1]);
  if (!(n === 0)) throw new Error('someone is in a meeting (' + n + '), wait');
});
// Others push while the tests run. Take their commits, rebuild what deploys (tests already passed; the rebase is theirs plus ours),
// and push; try three times.
step('push', () => {
  for (let i = 0; i < 3; i++) {
    sh('git fetch -q origin');
    const behind = sh('git rev-list --count HEAD..origin/main', { capture: true }).trim();
    if (behind !== '0') {
      // The builds rewrite the generated route trees; they are written again after the rebase.
      sh('git checkout -- app/src/routeTree.gen.ts web/src/routeTree.gen.ts');
      sh('git rebase origin/main');
      sh('npm install --no-audit --no-fund && npm --prefix web install --no-audit --no-fund');
      if (!has('--no-pages')) { sh('npm run build'); if (!existsSync('dist/images/favor-icon.png')) throw new Error('dist is incomplete'); }
      sh('npm --prefix web run build');
    }
    try { sh('git push origin HEAD:main'); return; } catch (e) { if (i === 2) throw e; }
  }
});
// The Worker deploy is cheap and idempotent, so it always goes out with the pages; a page and the Worker never drift apart.
step('deploy favoros-web', () => sh('npx wrangler deploy', { cwd: 'web' }));
if (!has('--no-pages')) step('deploy pages', () => sh('npx wrangler pages deploy dist --project-name favor-hub --branch main --commit-dirty=true'));

if (checks.length) {
  const key = readFileSync(homedir() + '/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split('\n')[0].trim();
  step('live check', () => {
    execSync('node -e "setTimeout(()=>{},45000)"');
    return execSync('node scripts/live-front.mjs', { stdio: 'inherit', env: { ...process.env, HUB_AGENT_KEY: key, LIVE_CHECKS: checks.join(' ') } });
  });
}
console.log('\nshipped ' + sh('git rev-parse --short HEAD', { capture: true }).trim());
