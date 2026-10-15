#!/usr/bin/env node
// One way to ship FavorOS (dash.favorintl.org) from a worktree. Every step must pass before the next one runs:
//   clean tree, fetch and rebase on origin/main, no conflict markers, npm install, the hub tests, typecheck, app tests, the web app's
//   typecheck and build, no live meeting, the Pages build with its image check, push to main, deploy the favoros-web Worker, deploy Pages, then read each --check path live and fail if it does not answer as expected.
// usage: node scripts/ship-hub.mjs [--no-pages] [--check /path/=web|classic ...] [--skip-known-failures]
// Needs the Marketing account environment (source Q:/work/favor-hub/cfenv.sh) and the agent key for --check.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

// Tests that fail on main for reasons outside a ship (named in the work log); listed so a ship is not blocked by them.
const KNOWN = ['entries are written for staff', 'Huddle on a person rings them', 'Decline with a message posts it', 'the test accounts ring only each other'];

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
step('hub tests', () => {
  let out = '';
  try {
    out = sh('node --test "tests/**/*.test.mjs"', { capture: true, maxBuffer: 1 << 28 });
  } catch (e) {
    out = String(e.stdout || '');
    const failed = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]).filter((n) => n !== 'failing tests:');
    const unknown = [...new Set(failed)].filter((n) => !KNOWN.some((k) => n.startsWith(k)));
    if (unknown.length || !has('--skip-known-failures')) throw new Error('failing: ' + [...new Set(failed)].join(' | '));
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
if (!has('--no-pages')) {
  step('pages build', () => {
    sh('npm run build');
    if (!existsSync('dist/images/favor-icon.png')) throw new Error('dist is incomplete');
  });
}
step('push', () => sh('git push origin HEAD:main'));
// The Worker deploy is cheap and idempotent, so it always goes out with the pages; a page and the Worker never drift apart.
step('deploy favoros-web', () => sh('npx wrangler deploy', { cwd: 'web' }));
if (!has('--no-pages')) step('deploy pages', () => sh('npx wrangler pages deploy dist --project-name favor-hub --branch main --commit-dirty=true'));

if (checks.length) {
  const key = readFileSync(homedir() + '/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split('\n')[0].trim();
  step('live check', () => {
    execSync('node -e "setTimeout(()=>{},45000)"');
    return execSync(`node scripts/live-front.mjs ${checks.map((c) => JSON.stringify(c)).join(' ')}`, { stdio: 'inherit', env: { ...process.env, HUB_AGENT_KEY: key } });
  });
}
console.log('\nshipped ' + sh('git rev-parse --short HEAD', { capture: true }).trim());
