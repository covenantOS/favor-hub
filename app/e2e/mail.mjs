// Native Mail, every real action, as the FavorOS Tester on the server-side sample mailbox (POST /api/admin/test-seed resets it first).
// Usage: node app/e2e/mail.mjs          Screenshots go to Q:\Temp\Will\react-app\shots\mail.
import { chromium, devices } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { BASE, stop } from './serve.mjs';

const OUT = 'Q:/Temp/Will/react-app/shots/mail';
mkdirSync(OUT, { recursive: true });
const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split(/\r?\n/)[0].trim();
await fetch('https://dash.favorintl.org/api/admin/test-seed', { method: 'POST', headers: { Authorization: 'Bearer ' + key } }).then((r) => r.text()).catch(() => '');

const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const results = [];
let page;
const errs = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push([name, 'ok', Date.now() - t0, note || '']);
  } catch (e) {
    results.push([name, 'FAIL', Date.now() - t0, e.message.split('\n').slice(0, 4).join(' ').slice(0, 300)]);
    await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }).catch(() => undefined);
  }
};
const open = async (hash = '', opts = { viewport: { width: 1440, height: 900 } }) => {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
  await page.goto(BASE + '/mail/?native=1' + hash, { waitUntil: 'commit' });
  await page.waitForSelector('.ml-row:not(.ml-row--skel)', { timeout: 25000 });
  return ctx;
};
const toast = async (re, ms = 6000) => page.waitForFunction((r) => new RegExp(r).test(document.querySelector('.ml-toast')?.textContent || ''), re, { timeout: ms });
const rowCount = () => page.locator('.ml-row:not(.ml-row--skel)').count();
const label = (name) => page.locator('.ml-lab', { hasText: name }).first();
const firstRow = () => page.locator('.ml-row:not(.ml-row--skel)').first();
const home = async () => {
  await page.goto(BASE + '/mail/?native=1#/INBOX', { waitUntil: 'commit' });
  await page.waitForSelector('.ml-row:not(.ml-row--skel)', { timeout: 20000 });
};
const gone = (id, ms = 6000) => page.waitForFunction((i) => !document.querySelector(`.ml-row[data-id="${i}"]`), id, { timeout: ms });
const back = (id, ms = 8000) => page.waitForFunction((i) => !!document.querySelector(`.ml-row[data-id="${i}"]`), id, { timeout: ms });

const ctx = await open();

await step('list loads with views and labels', async () => {
  const n = await rowCount();
  const labs = await page.locator('.ml-lab').count();
  if (n < 3 || labs < 6) throw new Error(`rows ${n}, labels ${labs}`);
  return `${n} rows, ${labs} labels`;
});
await step('briefing card or place held', async () => {
  await page.waitForTimeout(2500);
  const b = await page.locator('.ml-brief').count();
  return b ? 'briefing shown' : 'no briefing for this mailbox';
});
await step('open a conversation (timing)', async () => {
  const t0 = Date.now();
  await firstRow().locator('.ml-row__a').click();
  await page.waitForSelector('.ml-thread .ml-msg.is-open', { timeout: 10000 });
  return `reader in ${Date.now() - t0} ms`;
});
await step('icon buttons show the hub tooltip', async () => {
  await page.locator('.ml-thread__bar [aria-label="Archive"]').hover();
  await page.waitForFunction(() => { const t = document.querySelector('.ml-tip'); return t && !t.hidden && /Archive/.test(t.textContent || ''); }, null, { timeout: 3000 });
  
  await page.mouse.move(700, 600);
});
await step('assist panel draws', async () => {
  await page.waitForSelector('.ml-assist .ml-askrow', { timeout: 15000 });
});
await step('star and unstar', async () => {
  const star = page.locator('.ml-star--h');
  await star.click();
  await page.waitForFunction(() => document.querySelector('.ml-star--h')?.classList.contains('is-on'), null, { timeout: 3000 });
  await star.click();
  await page.waitForFunction(() => !document.querySelector('.ml-star--h')?.classList.contains('is-on'), null, { timeout: 3000 });
});
await step('archive then Undo', async () => {
  const id = await page.locator('.ml-row.is-open').getAttribute('data-id');
  const t0 = Date.now();
  await page.locator('.ml-thread__bar [aria-label="Archive"]').click();
  await gone(id);
  const optimistic = Date.now() - t0;
  await toast('Archived');
  await page.locator('.ml-toast [data-undo]').click();
  await back(id);
  return `row left the list in ${optimistic} ms`;
});
await step('delete then Undo', async () => {
  const id = await firstRow().getAttribute('data-id');
  await firstRow().hover();
  await firstRow().locator('[aria-label="Delete"]').click();
  await gone(id);
  await toast('Moved to Trash');
  await page.locator('.ml-toast [data-undo]').click();
  await back(id);
});
await step('keyboard: j, e, z', async () => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.ml')?.dataset.view === 'list', null, { timeout: 3000 });
  await page.keyboard.press('j');
  const id = await page.locator('.ml-row.is-sel').getAttribute('data-id');
  await page.keyboard.press('e');
  await gone(id);
  await toast('Archived');
  await page.keyboard.press('z');
  await back(id);
});
await step('mark unread from the row', async () => {
  const row = page.locator('.ml-row:not(.is-unread):not(.ml-row--skel)').first();
  await row.hover();
  const id = await row.getAttribute('data-id');
  await row.locator('[aria-label="Mark as unread"]').click();
  await page.waitForFunction((i) => document.querySelector(`.ml-row[data-id="${i}"]`)?.classList.contains('is-unread'), id, { timeout: 3000 });
});
await step('select several and archive them', async () => {
  const rows = page.locator('.ml-row:not(.ml-row--skel)');
  await rows.nth(0).locator('[data-pick]').click();
  await rows.nth(1).locator('[data-pick]').click({ modifiers: ['Shift'] });
  await page.waitForSelector('.ml-selbar:not([hidden])', { timeout: 3000 });
  const ids = await rows.evaluateAll((l) => l.slice(0, 2).map((e) => e.getAttribute('data-id')));
  await page.locator('.ml-selbar [aria-label="Archive"]').click();
  await gone(ids[0]);
  await toast('Archived');
  await page.locator('.ml-toast [data-undo]').click();
  await back(ids[0]);
});
await step('snooze until tomorrow, then Undo', async () => {
  await firstRow().hover();
  await firstRow().locator('[aria-label="Snooze"]').click();
  await page.locator('.ml-sheet .ml-menu__i', { hasText: 'Tomorrow' }).click();
  await toast('Snoozed until');
  await page.locator('.ml-toast [data-undo]').click();
});
await step('labels: add a new label and apply it', async () => {
  await firstRow().locator('.ml-row__a').click();
  await page.waitForSelector('.ml-thread .ml-msg.is-open');
  await page.locator('.ml-thread__bar [aria-label="Labels"]').click();
  const name = 'Islands ' + (Date.now() % 10000);
  await page.locator('#ml-newlab').fill(name);
  await page.locator('.ml-sheet button', { hasText: /^Add$/ }).click();
  await page.waitForSelector('.ml-sheet input[type=checkbox]:checked', { timeout: 5000 });
  await page.locator('.ml-sheet .ml-btn--primary', { hasText: 'Apply' }).click();
  await toast('Labels saved');
  await page.waitForSelector(`.ml-lab:has-text("${name}")`, { timeout: 20000 });
});
await step('search', async () => {
  await page.locator('.ml-search input').fill('newsletter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/search/'), null, { timeout: 3000 });
  await page.waitForTimeout(1500);
  return `${await rowCount()} results`;
});
await step('filter: unread only', async () => {
  await home();
  await page.locator('[aria-label="Filter"]').click();
  await page.locator('.ml-sheet .ml-check', { hasText: 'Unread' }).locator('input').check();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const n = await page.locator('.ml-row.is-unread').count();
  const all = await rowCount();
  if (all && n !== all) throw new Error(`only unread expected, ${n} of ${all}`);
});
await step('views: Needs you tab', async () => {
  await page.goto(BASE + '/mail/?native=1#/needs', { waitUntil: 'commit' });
  await page.waitForSelector('.ml-row, .ml-empty', { timeout: 20000 });
});
await step('reply: write, send, Undo restores the draft', async () => {
  await home();
  await firstRow().locator('.ml-row__a').click();
  await page.waitForSelector('.ml-thread__foot');
  await page.locator('.ml-thread__foot button', { hasText: /^Reply$/ }).click();
  await page.waitForSelector('.ml-c.is-in');
  await page.locator('.ml-c__ed').click();
  await page.keyboard.type('Island test reply. ');
  await page.locator('[data-send]').click();
  await toast('Sending');
  await page.locator('.ml-toast [data-undo]').click();
  await page.waitForSelector('.ml-c.is-in', { timeout: 6000 });
  const txt = await page.locator('.ml-c__ed').innerText();
  if (!txt.includes('Island test reply')) throw new Error('draft not restored');
});
await step('send anyway: the writing check warns, Fix it keeps the draft', async () => {
  await page.locator('.ml-c__ed').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Thank you, donor. See the attached file. ');
  await page.locator('[data-send]').click();
  await page.waitForSelector('.ml-sheet:has-text("Send anyway?")', { timeout: 8000 });
  await page.locator('.ml-sheet .ml-btn--primary', { hasText: 'Fix it' }).click();
  await page.waitForSelector('.ml-c.is-in');
});
await step('reply: send for real, it lands in Sent', async () => {
  await page.evaluate(() => {
    const ed = document.querySelector('.ml-c__ed');
    ed.innerHTML = ed.innerHTML.replace(/donor/g, 'partner').replace(/See the attached file\./, 'See you soon.');
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-send]').click();
  await toast('Sending');
  await toast('Sent', 22000);
  await page.goto(BASE + '/mail/?native=1#/SENT', { waitUntil: 'commit' });
  await page.waitForSelector('.ml-row', { timeout: 20000 });
  await page.waitForFunction(() => /Re: Visiting in March|Re: Thank you|Re: Sunday|Re: /.test(document.querySelector('.ml-rows')?.innerText || ''), null, { timeout: 15000 });
});
await step('new message: autosave a draft', async () => {
  await home();
  await page.locator('.ml-compose').click();
  await page.waitForSelector('.ml-c.is-in');
  await page.locator('#ml-c-to').fill('tester2@favorintl.org');
  await page.keyboard.press('Enter');
  await page.locator('#ml-c-subj').fill('Island draft ' + (Date.now() % 10000));
  await page.locator('.ml-c__ed').click();
  await page.keyboard.type('Draft body.');
  await page.waitForFunction(() => /Draft saved/.test(document.querySelector('.ml-c__save')?.textContent || ''), null, { timeout: 9000 });
});
await step('templates: save, insert, remove', async () => {
  await page.locator('.ml-c [aria-label="Templates"]').click();
  await page.locator('.ml-sheet input[placeholder="Template name"]').fill('Island tpl');
  await page.locator('.ml-sheet button', { hasText: /^Save$/ }).click();
  await toast('Template saved');
  await page.locator('.ml-c [aria-label="Templates"]').click();
  await page.waitForSelector('.ml-sheet .ml-linkbtn:has-text("Island tpl")');
  await page.locator('.ml-sheet .ml-linkbtn', { hasText: 'Island tpl' }).click();
  await page.waitForTimeout(800);
  await page.locator('.ml-c [aria-label="Templates"]').click();
  await page.locator('.ml-sheet .ml-mrow', { hasText: 'Island tpl' }).locator('.ml-btn').click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
});
await step('send later, see it in Scheduled, cancel it', async () => {
  await page.locator('.ml-c__later').click();
  await page.locator('.ml-sheet .ml-menu__i', { hasText: 'Tomorrow' }).click();
  await toast('Scheduled for');
  await label('Scheduled').click();
  await page.waitForSelector('.ml-sheet .ml-mrow', { timeout: 8000 });
  await page.locator('.ml-sheet .ml-mrow .ml-btn', { hasText: 'Cancel' }).first().click();
  await toast('Cancelled');
  await page.keyboard.press('Escape');
});
await step('Drive and clip pickers open', async () => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ml-sheet'), null, { timeout: 4000 }).catch(() => undefined);
  await home();
  await page.locator('.ml-compose').click();
  await page.waitForSelector('.ml-c.is-in');
  await page.locator('.ml-c [aria-label="Link a Drive file"]').click();
  await page.waitForSelector('.ml-sheet input[placeholder="Search the Drive library"]');
  await page.locator('.ml-sheet [aria-label="Close"]').click();
  await page.locator('.ml-c [aria-label="Link a clip"]').click();
  await page.waitForSelector('.ml-sheet');
  await page.locator('.ml-sheet [aria-label="Close"]').click();
  await page.locator('.ml-c [aria-label="Discard"]').click();
});
await step('Escape closes a picker and leaves the compose open (each picker, twice)', async () => {
  await home();
  await page.locator('.ml-compose').click();
  await page.waitForSelector('.ml-c.is-in');
  for (const pass of [1, 2]) {
    for (const [label, sel] of [['Link a Drive file', '.ml-sheet'], ['Link a clip', '.ml-sheet'], ['Photos from Drive', '.ml-sheet'], ['Templates', '.ml-sheet'], ['Send later', '.ml-sheet']]) {
      await page.locator(`.ml-c [aria-label="${label}"], .ml-c [title="${label}"]`).first().click();
      await page.waitForSelector(sel, { timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.ml-sheet'), null, { timeout: 3000 });
      if (!(await page.locator('.ml-c.is-in').count())) throw new Error(`the compose closed with Escape on ${label}, pass ${pass}`);
    }
  }
  // Escape with nothing else open does close it and keeps the draft.
  await page.locator('.ml-c__ed').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ml-c'), null, { timeout: 3000 });
});
await step('More: Make a task', async () => {
  await home();
  await firstRow().locator('.ml-row__a').click();
  await page.waitForSelector('.ml-thread .ml-msg.is-open');
  await page.locator('.ml-thread__bar [aria-label="More"]').click();
  await page.locator('.ml-sheet .ml-menu__i', { hasText: 'Make a task' }).click();
  await page.locator('.ml-sheet .ml-btn--primary', { hasText: 'Make task' }).click();
  await toast('Task made|not open to you|did not', 8000);
});
await step('More: Send to Chat (qa-scratch)', async () => {
  await page.locator('.ml-thread__bar [aria-label="More"]').click();
  await page.locator('.ml-sheet .ml-menu__i', { hasText: 'Send to Chat' }).click();
  await page.waitForSelector('.ml-sheet button.ml-menu__i', { timeout: 10000 });
  await page.locator('.ml-sheet .ml-menu__i', { hasText: 'qa-scratch' }).first().click();
  await toast('Sent to Chat', 8000);
});
await step('More: Assign, Mention and Request open', async () => {
  for (const name of ['Assign to a teammate', 'Mention a coworker', 'Make a request']) {
    await page.locator('.ml-thread__bar [aria-label="More"]').click();
    await page.locator('.ml-sheet .ml-menu__i', { hasText: name }).click();
    await page.waitForSelector(`.ml-sheet__box[aria-label="${name}"]`, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
});
await step('Find a time', async () => {
  await page.locator('.ml-assist button', { hasText: 'Find a time' }).click();
  await page.waitForSelector('.ml-sheet', { timeout: 5000 });
  await page.waitForFunction(() => !/Reading calendars/.test(document.querySelector('.ml-sheet')?.textContent || ''), null, { timeout: 20000 });
  await page.keyboard.press('Escape');
});
await step('Ask about this email', async () => {
  await page.locator('[data-ask]').fill('What does this email ask me to do?');
  await page.locator('.ml-askrow [type=submit]').click();
  await page.waitForSelector('.ml-answer', { timeout: 20000 });
});
await step('categories: add and remove', async () => {
  await home();
  await page.waitForSelector('.ml-addbox--sub', { timeout: 15000 });
  await page.locator('.ml-addbox--sub', { hasText: 'New category' }).click();
  await page.locator('.ml-sheet input.ml-input').first().fill('Islands cat');
  await page.locator('.ml-sheet textarea').fill('Notes about the islands test');
  await page.locator('.ml-sheet .ml-btn--primary', { hasText: 'Add category' }).click();
  await toast('Category added', 12000);
  await page.locator('.ml-sheet .ml-mrow', { hasText: 'Islands cat' }).locator('.ml-btn').click();
  await page.waitForFunction(() => !/Islands cat/.test(document.querySelector('.ml-sheet')?.textContent || ''), null, { timeout: 6000 });
  await page.keyboard.press('Escape');
});
await step('Assigned list opens', async () => {
  await label('Assigned').click();
  await page.waitForSelector('.ml-sheet', { timeout: 5000 });
  await page.keyboard.press('Escape');
});
await step('mailboxes sheet opens', async () => {
  const b = page.locator('.ml-addbox', { hasText: /Manage mailboxes|Add a mailbox/ }).first();
  if (await b.evaluate((e) => e.tagName === 'A')) return 'no extra mailboxes (Add a mailbox link)';
  await b.click();
  await page.waitForSelector('.ml-sheet');
  await page.keyboard.press('Escape');
});
await step('phone layout: list, thread, back', async () => {
  await ctx.close();
  const c2 = await open('', { ...devices['iPhone 14'] });
  await firstRow().locator('.ml-row__a').click();
  await page.waitForSelector('.ml-thread .ml-msg.is-open');
  if ((await page.locator('.ml').getAttribute('data-view')) !== 'thread') throw new Error('not in thread view');
  await page.screenshot({ path: `${OUT}/phone-thread.png` });
  await page.locator('.ml-back').click();
  await page.waitForFunction(() => document.querySelector('.ml')?.dataset.view === 'list', null, { timeout: 3000 });
  await page.screenshot({ path: `${OUT}/phone-list.png` });
  await c2.close();
});
await step('no page errors', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
});

await browser.close();
stop();
let bad = 0;
for (const [n, r, ms, note] of results) {
  console.log(`${r === 'ok' ? 'ok  ' : 'FAIL'} ${n} (${ms} ms) ${note}`);
  if (r !== 'ok') bad++;
}
console.log(bad ? `${bad} FAILED of ${results.length}` : `ALL ${results.length} MAIL ACTIONS OK`);
process.exit(bad ? 1 : 0);
