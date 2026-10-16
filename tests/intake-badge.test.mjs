// The Projects rail badge, the Intake tab and the phone bar show one number for requests: the ones waiting in Intake or Triage on the person.
// Made-up people only; the live database is never touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { DESIGN, FOUNDER, OUTSIDER, T as TESTER, VIDEO, WILL, ic, iw, pc, rows } from './support/intake-world.mjs';

const send = async (w, user, text, extra = {}) => {
  const r = await ic(w, user, 'POST', 'submit', { text, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.request;
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/** The intake world plus the tables the menu counts read (receipts, expenses, learning). */
function world() {
  const w = iw();
  for (const f of ['db/receipts.sql', 'db/expenses.sql', 'db/learn.sql']) {
    for (const part of read(f).split(/;\s*(?:\r?\n|$)/)) if (part.trim()) { try { w.d1.exec(part + ';'); } catch { /* a table this world already has */ } }
  }
  return w;
}
const staff = (u) => ({ ...u, role: 'staff' });
const admin = (u) => ({ ...u, role: 'admin' });
const access = (over = {}) => ({ admin: false, kpi: true, approver: false, workCenter: false, meetings: true, chat: true, tasks: true, learn: false, mail: false, projects: true, ...over });
const tabCount = (teams) => teams.reduce((n, t) => n + t.counts.waiting, 0);

test('the rail badge counts Intake and Triage requests for a person who triages, and the tab says the same number', async () => {
  const w = world();
  const T = await import('../functions/_lib/hub/today.ts');
  const P = await import('../functions/_lib/projects/links/today.ts');
  const a = await send(w, VIDEO, 'Add a banner to the home page of the website');
  await send(w, OUTSIDER, 'Fix the careers page on the website');
  await send(w, OUTSIDER, 'Design a flyer for the banquet');

  // Two Tech requests and one Marketing request wait in Intake on an admin who triages both teams.
  const before = (await ic(w, WILL, 'GET', 'teams')).data.teams;
  assert.deepEqual(before.map((t) => [t.team, t.counts.waiting]), [['tech', 2], ['marketing', 1]]);
  let nav = await T.navCounts(w.env, admin(WILL), access({ admin: true }));
  assert.equal(nav.projectsMine, tabCount(before), 'rail badge = Intake tab = 3');
  assert.equal(nav.projectsMine, (await P.projectCards(w.env, admin(WILL))).reduce((n, c) => n + c.n, 0), 'and the Projects cards on Today add up to the same number');

  // Accept one into Triage. It leaves Intake and still waits on the person who owns it.
  assert.equal((await ic(w, WILL, 'POST', `r/${a.id}/accept`, {})).status, 200);
  // The world's clock is fixed at NOW; a due date counted from it falls behind the real date, so the card is due far ahead.
  w.d1.db.prepare("UPDATE hub_tasks SET due_date = '2099-01-01' WHERE due_date IS NOT NULL").run();
  const mid = (await ic(w, WILL, 'GET', 'teams')).data.teams;
  assert.deepEqual(mid.map((t) => [t.team, t.counts.intake, t.counts.triage, t.counts.waiting]), [['tech', 1, 1, 2], ['marketing', 1, 0, 1]]);
  nav = await T.navCounts(w.env, admin(WILL), access({ admin: true }));
  assert.equal(nav.projectsMine, tabCount(mid));

  // Someone else owns the Triage card: it leaves the first person's number, and the badge follows the tab.
  w.d1.db.prepare('UPDATE hub_tasks SET owner_email = ? WHERE request_id = ?').run(DESIGN.email, a.id);
  const later = (await ic(w, WILL, 'GET', 'teams')).data.teams;
  assert.equal(tabCount(later), 2, 'a card owned by someone else is not this person to act on');
  assert.equal((await T.navCounts(w.env, admin(WILL), access({ admin: true }))).projectsMine, tabCount(later));
  const mk = (await ic(w, DESIGN, 'GET', 'teams')).data.teams;
  assert.deepEqual(mk.map((t) => t.team), ['marketing']);
  assert.equal(mk[0].counts.waiting, 1, 'the Marketing director sees the Marketing request');

  // A finished request no longer counts.
  const card = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', a.id)[0].id;
  assert.equal((await pc(w, WILL, 'PATCH', `tasks/${card}`, { status: 'done' })).status, 200);
  assert.equal(tabCount((await ic(w, WILL, 'GET', 'teams')).data.teams), 2);
});

test('a person who triages nothing gets no request number, and the phone bar sums the one Projects entry', async () => {
  const w = world();
  const T = await import('../functions/_lib/hub/today.ts');
  const { AREAS } = await import('../src/data/areas.ts');
  await send(w, VIDEO, 'Add a banner to the home page of the website');
  assert.deepEqual((await ic(w, FOUNDER, 'GET', 'teams')).data.teams, []);
  assert.equal((await T.navCounts(w.env, staff(FOUNDER), access())).projectsMine, 0);
  assert.equal((await T.navCounts(w.env, staff(VIDEO), access())).projectsMine, 0, 'the asker is not counted for their own request');

  const counts = await T.navCounts(w.env, admin(WILL), access({ admin: true }));
  assert.equal(counts.projectsMine, 1);
  // The rail reads counts[page.count] for each page of the area; the phone bar and the area header add the pages up (app/src/shell/model.ts).
  const area = AREAS.find((x) => x.id === 'projects');
  const pages = area.pages.filter((p) => p.menu !== false);
  assert.deepEqual(pages.map((p) => [p.id, p.count]), [['projects', 'projectsMine'], ['request-new', undefined], ['my-requests', undefined]], 'Projects carries the count key projectsMine; the two request pages carry none');
  assert.equal(pages.reduce((n, p) => n + (Number(counts[p.count]) || 0), 0), 1, 'rail badge = phone bar');
});

test('test accounts are counted against the test pipeline only', async () => {
  const w = world();
  const T = await import('../functions/_lib/hub/today.ts');
  await send(w, TESTER, 'Add a test banner to the website');
  assert.equal((await T.navCounts(w.env, admin(WILL), access({ admin: true }))).projectsMine, 0, 'a real admin is not counted for a test request');
  assert.equal((await T.navCounts(w.env, admin(TESTER), access({ admin: true }))).projectsMine, 1, 'the test account is');
  await send(w, VIDEO, 'Fix the careers page on the website');
  assert.equal((await T.navCounts(w.env, admin(TESTER), access({ admin: true }))).projectsMine, 1, 'and a real request does not add to the number of a test account, which matches its own board');
  assert.equal((await T.navCounts(w.env, admin(WILL), access({ admin: true }))).projectsMine, 1, 'while the real admin counts the real one');
});
