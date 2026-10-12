// Run with: npm test
// Requests that fill themselves out and show where they are. Made-up requests and people only; the database is an in-memory copy.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { NOW, VIDEO, WILL, addRequest, call, rows, world } from './support/request-world.mjs';

const S = await import('../functions/_lib/requests/suggest.ts');
const P = await import('../functions/_lib/requests/progress.ts');
const route = await import('../functions/api/requests/route.ts');
const taskRoute = await import('../functions/_lib/requests/route.ts');
const mineApi = await import('../functions/api/requests/mine.ts');

// 2026-10-12 is a Monday.
const TODAY = '2026-10-12';

test('dates in the words: weekdays, calendar dates, "in two weeks", end of the week', () => {
  assert.equal(S.fridayOf(TODAY), '2026-10-16');
  assert.equal(S.fridayOf('2026-10-16'), '2026-10-16');
  assert.equal(S.fridayOf('2026-10-17'), '2026-10-23', 'a Saturday points at the coming Friday');
  assert.equal(S.dateFromText('Need it by Friday', TODAY).date, '2026-10-16');
  assert.equal(S.dateFromText('Please have it done next Friday', TODAY).date, '2026-10-23');
  assert.equal(S.dateFromText('the banquet is October 24th', TODAY).date, '2026-10-24');
  assert.equal(S.dateFromText('for 11/3', TODAY).date, '2026-11-03');
  assert.equal(S.dateFromText('on 1/5', TODAY).date, '2027-01-05', 'a date already past this year means next year');
  assert.equal(S.dateFromText('in two weeks', TODAY).date, '2026-10-26');
  assert.equal(S.dateFromText('by end of the week', TODAY).date, '2026-10-16');
  assert.equal(S.dateFromText('tomorrow morning', TODAY).date, '2026-10-13');
  assert.equal(S.dateFromText('Add Sarah to the team page', TODAY), null);
  assert.equal(S.addBusinessDays('2026-10-16', 1), '2026-10-19', 'a business day skips the weekend');
});

test('kind, where and who sees it come from the words', () => {
  const a = S.suggestFill("Could we add Sarah's bio to the team page on the website?", TODAY);
  assert.equal(a.kind, 'add');
  assert.equal(a.surface, 'website');
  assert.equal(a.title, "Add Sarah's bio to the team page on the website");
  assert.equal(a.audience, 'Public on favorintl.org');
  assert.equal(a.page_url, 'Team page');
  const b = S.suggestFill('The giving history on the partner portal shows the wrong year, please fix', TODAY);
  assert.equal(b.kind, 'change');
  assert.equal(b.surface, 'portal');
  assert.equal(b.audience, 'Partners on the portal');
  const c = S.suggestFill('Change "Join our team" to "Work with us" on https://www.favorintl.org/careers', TODAY);
  assert.equal(c.kind, 'change');
  assert.equal(c.now, 'Join our team');
  assert.equal(c.should, 'Work with us');
  assert.equal(c.page_url, 'https://www.favorintl.org/careers');
  const d = S.suggestFill('The FavorOS search is broken', TODAY);
  assert.equal(d.surface, 'dashboard');
  assert.equal(d.audience, 'Staff on FavorOS');
});

test('timing: a named date, urgent words, no rush, and the default of this Friday', () => {
  const dated = S.suggestFill('Add the banquet page by October 30', TODAY);
  assert.equal(dated.needed, 'By a date');
  assert.equal(dated.needed_date, '2026-10-30');
  assert.equal(dated.due_date, '2026-10-30');
  const urgent = S.suggestFill('The donate button is broken, fix this ASAP', TODAY);
  assert.equal(urgent.needed, 'As soon as possible');
  assert.equal(urgent.due_date, '2026-10-13');
  const lazy = S.suggestFill('Add a Spanish version of the about page, no rush', TODAY);
  assert.equal(lazy.needed, 'Whenever we get to it');
  assert.equal(lazy.due_date, '2026-10-26');
  const plain = S.suggestFill('Add a new job posting for a grants writer', TODAY);
  assert.equal(plain.needed, 'This week');
  assert.equal(plain.due_date, '2026-10-16');
  assert.match(plain.why.needed, /end of this week/);
});

test('the title drops the polite opener and stays short', () => {
  assert.equal(S.titleFrom('Hi! Can you please update the footer phone number? It is old.'), 'Update the footer phone number');
  assert.ok(S.titleFrom('x'.repeat(300)).length <= 100);
});

test('the owner is whoever took the most requests on that surface lately, else the Lead Developer', async () => {
  const w = world();
  // No history: the Lead Developer on the staff list.
  assert.equal((await S.suggestOwner(w.env, 'website', TODAY)).email, WILL.email);
  const a = addRequest(w, 'One');
  const b = addRequest(w, 'Two');
  const now = new Date().toISOString();
  for (const id of [a, b]) {
    w.d1.db.prepare('UPDATE requests SET created_at = ? WHERE id = ?').run(now, id);
    w.d1.db.prepare('INSERT INTO request_tasks (request_id, owner_email, updated_at) VALUES (?, ?, ?)').run(id, VIDEO.email, now);
  }
  const guess = await S.suggestOwner(w.env, 'website', S.easternDay());
  assert.equal(guess.email, VIDEO.email);
  assert.match(guess.why, /Took 2 of the last website requests/);
});

test('POST route keeps the suggestion with the request, and only an admin reads it back', async () => {
  const w = world();
  const app = readFileSync(new URL('../db/app.sql', import.meta.url), 'utf8');
  w.d1.exec(app.slice(app.indexOf('CREATE TABLE IF NOT EXISTS request_routes'), app.indexOf('CREATE INDEX IF NOT EXISTS idx_request_routes_at')));
  w.d1.exec(readFileSync(new URL('../db/requests-fill.sql', import.meta.url), 'utf8'));
  const ask = async (text) => {
    const res = await route.onRequestPost({ request: new Request('https://dash.favorintl.org/api/requests/route', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ text }) }), env: { ...w.env, AI: undefined }, waitUntil() {} });
    return res.json();
  };
  const made = await ask('Fix the typo on the careers page of the website by Friday');
  assert.equal(made.route, 'board');
  assert.equal(made.fill.kind, 'change');
  assert.equal(made.fill.surface, 'website');
  assert.equal(made.fill.owner.email, WILL.email);
  const marketing = await ask('We need a flyer for the October banquet');
  assert.equal(marketing.route, 'marketing');
  assert.ok(marketing.fill.due_date, 'every route gets a due date');
  assert.ok(marketing.fill.owner && marketing.fill.owner.why, 'and an owner with the reason');
  // Linked to the request once it is sent.
  const id = addRequest(w, 'Fix the typo on the careers page');
  await route.onRequestPut({ request: new Request('https://dash.favorintl.org/api/requests/route', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: made.id, chosen: 'board', request_id: id }) }), env: w.env });
  const admin = { data: { request: await taskRoute.fullRequest(w.env, id, { email: WILL.email, name: WILL.name, admin: true }) } };
  assert.equal(admin.data.request.suggest.owner.email, WILL.email);
  assert.match(admin.data.request.suggest.due_date, /^\d{4}-\d{2}-\d{2}$/);
  const staff = { data: { request: await taskRoute.fullRequest(w.env, id, { email: VIDEO.email, name: VIDEO.name, admin: false }) } };
  assert.equal(staff.data.request.suggest, undefined, 'a person who is not an admin does not see it');
});

test('where a request is: four stops, the owner, the due date and what moved last', async () => {
  const w = world();
  const id = addRequest(w, 'Add the October banquet page', 'asker@favorintl.org');
  const first = await P.myRequests(w.env, 'asker@favorintl.org', new Date(NOW));
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].steps.map((s) => [s.key, s.state]), [['sent', 'now'], ['approved', 'next'], ['in_progress', 'next'], ['done', 'next']]);
  assert.equal(first[0].statusWord, 'Waiting for review');
  assert.equal(first[0].owner, null);

  await call(w, WILL, 'PATCH', `${id}/task`, { due_date: '2026-10-16' });
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: '' });
  const { setStatus } = await import('../functions/_lib/db.ts');
  await setStatus(w.env, id, 'approved', 'Ada');
  await setStatus(w.env, id, 'in_progress', 'Ada');
  const mid = (await P.myRequests(w.env, 'ASKER@favorintl.org', new Date()))[0];
  assert.deepEqual(mid.steps.map((s) => s.state), ['done', 'done', 'now', 'next']);
  assert.equal(mid.owner.name, VIDEO.name);
  assert.equal(mid.due_date, '2026-10-16');
  assert.equal(mid.moves[0].text, 'Ada moved it to In progress');
  assert.ok(mid.moves.some((m) => m.text === `Sent to ${VIDEO.name}`));

  await setStatus(w.env, id, 'done', 'Ada');
  const end = (await P.myRequests(w.env, 'asker@favorintl.org', new Date()))[0];
  assert.deepEqual(end.steps.map((s) => s.state), ['done', 'done', 'done', 'done']);
  assert.equal(end.statusWord, 'Done');

  // Somebody else's request never shows.
  addRequest(w, 'Someone else', 'other@favorintl.org');
  assert.equal((await P.myRequests(w.env, 'asker@favorintl.org', new Date())).length, 1);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM requests')[0].n, 2);
});

test('GET mine needs a Google sign-in', async () => {
  const w = world();
  const anon = await mineApi.onRequestGet({ request: new Request('https://dash.favorintl.org/api/requests/mine'), env: w.env });
  assert.equal(anon.status, 401);
});
