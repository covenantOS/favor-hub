// Request email inside Projects: each person's choice (Immediately, Daily summary, None) decides how every request notice reaches them,
// the accepted notice included, and the done email goes to the person who asked and to nobody else. Made-up people only; mail lands in
// a list and the live database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { DESIGN, VIDEO, WILL, ic, iw, pc, rows } from './support/intake-world.mjs';
import { call } from './support/request-world.mjs';

const MONDAY_9AM = new Date('2026-10-19T13:00:00Z');

/** A world where the asker is not in Chat, so a notice reaches them by email. */
function world() {
  const w = iw();
  w.set('chat.enabled', 'off');
  w.set('requests.notify', 'on');
  w.env.RESEND_API_KEY = 'test-key';
  return w;
}

const subjects = (w, to) => w.mail.filter((m) => m.to === to).map((m) => m.subject);

test('the choice is read and saved on /api/requests/prefs, and a wrong word is refused', async () => {
  const w = world();
  assert.equal((await call(w, VIDEO, 'GET', 'prefs')).data.mode, 'now', 'no choice yet reads as Immediately');
  assert.equal((await call(w, VIDEO, 'PUT', 'prefs', { mode: 'daily' })).data.mode, 'daily');
  assert.equal((await call(w, VIDEO, 'GET', 'prefs')).data.mode, 'daily');
  assert.equal((await call(w, VIDEO, 'PUT', 'prefs', { mode: 'off' })).data.mode, 'off');
  assert.equal((await call(w, VIDEO, 'PUT', 'prefs', { mode: 'weekly' })).status, 400);
  assert.equal((await call(w, DESIGN, 'GET', 'prefs')).data.mode, 'now', 'one person\'s choice is not another\'s');
  const r = (await call(w, VIDEO, 'GET', 'prefs')).data;
  assert.equal(r.email, VIDEO.email);
  assert.equal(r.notices_on, true);
  assert.equal(r.email_on, true);
});

for (const [mode, now, summary] of [['now', true, false], ['daily', false, true], ['off', false, false]]) {
  test(`choice ${mode}: a question and an accept reach the person who asked ${now ? 'at once' : summary ? 'in the morning summary' : 'by no email'}`, async () => {
    const w = world();
    await call(w, VIDEO, 'PUT', 'prefs', { mode });
    const sent = await ic(w, VIDEO, 'POST', 'submit', { text: 'Add a banner to the home page of the website' });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    const id = sent.data.request.id;

    assert.equal((await ic(w, WILL, 'POST', `r/${id}/ask`, { question: 'Which page should it go on?' })).status, 200);
    const acc = await ic(w, WILL, 'POST', `r/${id}/accept`, {});
    assert.equal(acc.status, 200, JSON.stringify(acc.data));
    assert.equal(acc.data.told.via, now ? 'email' : summary ? 'summary' : 'none', JSON.stringify(acc.data.told));

    const toAsker = subjects(w, VIDEO.email);
    if (now) {
      assert.equal(toAsker.filter((s) => s.startsWith('Accepted:')).length, 1, 'accepted: one email');
      assert.equal(toAsker.filter((s) => s.includes('commented')).length, 1, 'question: one email');
    } else {
      assert.deepEqual(toAsker, [], 'nothing arrives at once');
    }

    // The weekday morning pass sends the summary to the people who chose it, and nothing to the others.
    const { dailyPass } = await import('../functions/_lib/requests/mail.ts');
    const run = await dailyPass(w.env, MONDAY_9AM);
    if (summary) {
      assert.equal(run.summaries, 1);
      const m = w.mail.find((x) => x.to === VIDEO.email && x.subject.startsWith('Requests:'));
      assert.ok(m, 'the summary was sent');
      assert.ok(m.html.includes('accepted your request') && m.html.includes('commented'), 'it lists the accept and the question');
      assert.equal((await dailyPass(w.env, new Date(MONDAY_9AM.getTime() + 600000))).summaries, 0, 'never the same notices twice');
    } else {
      assert.equal(run.summaries, 0);
      assert.ok(!w.mail.some((x) => x.to === VIDEO.email && x.subject.startsWith('Requests:')));
    }
    // The notices themselves stay for Today and the bell, whatever the choice.
    assert.ok(rows(w, "SELECT COUNT(*) AS n FROM request_notices WHERE email = ?", VIDEO.email)[0].n >= 1);
  });
}

test('a request sent to the team lead respects the lead\'s choice too', async () => {
  const w = world();
  await call(w, WILL, 'PUT', 'prefs', { mode: 'daily' });
  await ic(w, VIDEO, 'POST', 'submit', { text: 'Fix the footer link on the website' });
  assert.deepEqual(subjects(w, WILL.email).filter((s) => s.includes('sent you')), [], 'daily: no email for the new request at once');
  const { dailyPass } = await import('../functions/_lib/requests/mail.ts');
  assert.equal((await dailyPass(w.env, MONDAY_9AM)).summaries, 1, 'it is in the summary');
  await call(w, WILL, 'PUT', 'prefs', { mode: 'off' });
  await ic(w, VIDEO, 'POST', 'submit', { text: 'Fix the header link on the website' });
  assert.equal((await dailyPass(w.env, new Date(MONDAY_9AM.getTime() + 86400000))).summaries, 0, 'none: nothing in the morning either');
});

test('the done email goes to the person who asked alone, whichever choice they made', async () => {
  for (const mode of ['now', 'daily', 'off']) {
    const w = world();
    const posted = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('api.resend.com')) { posted.push(JSON.parse(init.body)); return new Response('{"id":"x"}', { status: 200 }); }
      return new Response('{}', { status: 200 });
    };
    try {
      await call(w, VIDEO, 'PUT', 'prefs', { mode });
      const id = (await ic(w, VIDEO, 'POST', 'submit', { text: 'Add a banner to the home page of the website' })).data.request.id;
      const card = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', id)[0].id;
      assert.equal((await pc(w, WILL, 'PATCH', `tasks/${card}`, { status: 'done' })).status, 200);
      await Promise.allSettled(w.pending.splice(0));
      const done = posted.filter((m) => m.subject.startsWith('Done:'));
      assert.equal(done.length, 1, mode);
      assert.deepEqual(done[0].to, [VIDEO.email], mode + ': the asker alone, no copy to the notify address');
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});
