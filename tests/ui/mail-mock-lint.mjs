// Runs lintapple on Mail drawn with invented mail (/mail/?mock=1): the list, a conversation, the More sheet and the message
// window, at phone, iPad and desktop size. The saved admin cookie has no Google sign-in, so the sweep reaches Mail only as its
// closed state; this covers the screens a signed-in person sees. Read only: writes are stopped at the network and the mock
// answers every mail call in the page.
//   HUB_COOKIES=<saved cookie json> HUB_URL=https://<branch>.favor-hub-d4n.pages.dev node tests/ui/mail-mock-lint.mjs
import { checkPage, validatePolicy } from 'lintapple';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE, HERE, ROOT, loadCookies, launch, newSession, clickFirst } from './lib.mjs';

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const basePolicy = await readJson(join(ROOT, 'ui-policy.json'));
const overrides = await readJson(join(HERE, 'profiles.json'));
const policyFor = (name) => {
  const o = overrides[name] || {};
  return validatePolicy({ ...basePolicy, ...o, typeRules: [...(o.typeRules || []), ...basePolicy.typeRules], controlSizeRules: [...(o.controlSizeRules || []), ...basePolicy.controlSizeRules] });
};
const cookies = await loadCookies();
const browser = await launch();
let total = 0;
for (const name of (process.env.HUB_PROFILES || 'phone,ipad,desktop').split(',')) {
  const { context, page } = await newSession(browser, name, cookies, []);
  const policy = policyFor(name);
  const seen = new Set();
  const check = async (state) => {
    await page.waitForTimeout(700);
    const report = await checkPage(page, policy);
    // The menu, the top bar and the phone bar belong to the shell and are covered by the main sweep.
    const fresh = report.findings.filter((f) => !/> (nav|header|aside):nth-of-type\(1\)/.test(f.selector) && !/could not be measured/.test(f.message) && !seen.has(f.rule + '|' + f.selector));
    fresh.forEach((f) => seen.add(f.rule + '|' + f.selector));
    total += fresh.length;
    console.log(`${name} ${state}: ${fresh.length} (page total ${report.findings.length})`);
    for (const f of fresh) console.log(`  ${f.rule}  ${f.selector}  ${f.message}`);
  };
  await page.goto(BASE + '/mail/?mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]');
  await check('list');
  await page.click('.ml-row[data-id] .ml-row__a');
  await page.waitForSelector('.ml-msg.is-open iframe');
  await check('conversation');
  await clickFirst(page, '.ml-thread__bar [data-act="thread-more"]');
  await check('more sheet');
  await clickFirst(page, '.ml-sheet .ml-iconbtn[data-close]');
  await page.waitForTimeout(500);
  if (!(await clickFirst(page, '.ml-thread__foot [data-act="forward"]'))) { await clickFirst(page, '.ml-pbar [data-act="reply-menu"]'); await page.waitForTimeout(400); await clickFirst(page, '[data-r="forward"]'); }
  await page.waitForSelector('.ml-c.is-in');
  await check('message window');
  await context.close();
}
await browser.close();
console.log(`mail findings: ${total}`);
process.exit(total ? 1 : 0);
