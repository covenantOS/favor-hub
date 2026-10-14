// Notifications (2026-10-14): tag emails, a burst as one email, the first tag past an email choice, followers added by someone
// else, "Did you see this?" nudges on weekday mornings, the tagger told once, and feedback reply emails. Invented people only;
// an in-memory D1 from the repository's schema files, mail collected by MAIL_HOOK. Nothing real is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = '2026-10-11T12:00:00.000Z';
const ADA = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const VIC = { email: 'vic@favorintl.org', name: 'Vic Video', picture: '', role: 'staff', via: 'google', kpi: true };
const DAN = { email: 'dan@favorintl.org', name: 'Dan Design', picture: '', role: 'staff', via: 'google', kpi: true };
const OZZ = { email: 'ozzy@favorintl.org', name: 'Ozzy Other', picture: '', role: 'staff', via: 'google', kpi: true };

function world() {
  const d1 = memoryD1();
  d1.exec(read('db/schema.sql'));
  d1.exec(read('db/admin-home.sql'));
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  d1.exec(`CREATE TABLE brain_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, email TEXT NOT NULL, name TEXT, source TEXT NOT NULL, rating TEXT, comment TEXT, ref TEXT, question TEXT, reading TEXT, page TEXT, status TEXT NOT NULL DEFAULT 'new', reply TEXT, handled_by TEXT, handled_at TEXT, reply_seen_at TEXT, shot_key TEXT)`);
  for (const f of ['meetings', 'work', 'clips', 'clips-v2', 'favor-chat', 'favor-chat-private', 'request-tasks', 'google', 'expenses', 'projects', 'projects-links', 'notify', 'feedback-mail']) d1.exec(read(`db/${f}.sql`));
  const ins = (sql, ...a) => d1.db.prepare(sql).run(...a);
  for (const u of [ADA, VIC, DAN, OZZ]) ins('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', u.email, u.name, '', u.role, NOW, NOW);
  for (const u of [ADA, VIC, DAN, OZZ]) ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', u.email, u.name, 'Staff', 'Marketing', 1);
  ins("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'on', 'test', ?)", NOW);
  ins("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.enabled', 'staff', 'test', ?)", NOW);
  const room = { idFromName: (n) => n, get: () => ({ fetch: async () => Response.json({}) }) };
  const mail = [];
  const env = { DB: d1, CHAT_ROOM: room, UPLOADS: { put: async () => {}, get: async () => null }, MAIL_HOOK: (m) => { mail.push(m); return true; } };
  return { d1, env, mail, pending: [] };
}

const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
async function core(w, user, method, path, body) {
  const { handle } = await import('../functions/_lib/projects/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/' + path, init), env: w.env, user, path: path.split('?')[0].split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json().catch(() => null) };
}
const seen = (w, ...users) => { for (const u of users) w.d1.db.prepare("INSERT OR IGNORE INTO hub_task_seen (email, task_id, at) VALUES (?, 'tsk_old', ?)").run(u.email, NOW); };
const later = (min) => new Date(Date.now() + min * 60000);

test('a mention emails at once: "Ada tagged you in", the comment, Open the task, from Ada via FavorOS', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  seen(w, OZZ);
  const t = await core(w, ADA, 'POST', 'tasks', { title: 'Plan the gala', owner_email: ADA.email });
  await core(w, ADA, 'POST', `tasks/${t.data.task.id}/comments`, { body: `Can you take this, <@${OZZ.email}>? The venue needs an answer Friday.` });
  assert.equal(w.mail.length, 1);
  const m = w.mail[0];
  assert.equal(m.to, OZZ.email);
  assert.equal(m.subject, 'Ada tagged you in Plan the gala');
  assert.equal(m.fromName, 'Ada Admin via FavorOS');
  assert.equal(m.replyTo, ADA.email);
  assert.match(m.text, /The venue needs an answer Friday/);
  assert.match(m.html, /Open the task/);
  assert.doesNotMatch(m.html + m.text + m.subject, /—/);
  assert.equal(rows(w, 'SELECT * FROM hub_task_nudges WHERE email = ?', OZZ.email).length, 1, 'the tag starts nudges');
});

test('a burst of edits is one email: the first goes at once, the rest wait 3 minutes and go together', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  seen(w, OZZ);
  const t = await core(w, ADA, 'POST', 'tasks', { title: 'Fix the banner', owner_email: OZZ.email });
  assert.equal(w.mail.length, 1);
  await core(w, ADA, 'POST', `tasks/${t.data.task.id}/comments`, { body: 'First thought.' });
  await core(w, ADA, 'POST', `tasks/${t.data.task.id}/comments`, { body: 'Second thought.' });
  assert.equal(w.mail.length, 1, 'held while the burst lasts');
  const { mailFresh } = await import('../functions/_lib/projects/links/email.ts');
  assert.equal(await mailFresh(w.env, later(1)), 0, 'still inside 3 minutes');
  assert.equal(await mailFresh(w.env, later(4)), 1);
  assert.equal(w.mail.length, 2);
  assert.match(w.mail[1].text, /First thought\.[\s\S]*Second thought\./);
  assert.equal(await mailFresh(w.env, later(9)), 0, 'never twice');
});

test('the first tag reaches someone who has never opened Projects, even with email off; the next one respects the choice', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  w.d1.db.prepare("INSERT INTO hub_project_prefs (email, mail_mode, calendar, updated_at) VALUES (?, 'off', 1, ?)").run(DAN.email, NOW);
  await core(w, ADA, 'POST', 'tasks', { title: 'Design the card', owner_email: DAN.email });
  assert.equal(w.mail.length, 1);
  assert.equal(w.mail[0].to, DAN.email);
  await core(w, ADA, 'POST', 'tasks', { title: 'Design the flyer', owner_email: DAN.email });
  const { mailFresh } = await import('../functions/_lib/projects/links/email.ts');
  await mailFresh(w.env, later(5));
  assert.equal(w.mail.length, 1, 'email off holds after the first');
});

test('added as a follower by someone else is told; following yourself tells nobody', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  seen(w, VIC, OZZ);
  const t = await core(w, ADA, 'POST', 'tasks', { title: 'Shoot the video', owner_email: ADA.email });
  await core(w, ADA, 'PUT', `tasks/${t.data.task.id}/people`, { add: [{ email: VIC.email, role: 'follower' }] });
  assert.equal(w.mail.at(-1).to, VIC.email);
  assert.equal(w.mail.at(-1).subject, 'Ada added you to Shoot the video');
  const n = w.mail.length;
  await core(w, OZZ, 'PUT', `tasks/${t.data.task.id}/people`, { add: [{ email: OZZ.email, role: 'follower' }] });
  assert.equal(w.mail.length, n);
  assert.equal(rows(w, "SELECT * FROM hub_task_notices WHERE email = ? AND kind = 'followed'", OZZ.email).length, 0);
});

test('nudges: weekday mornings only, 1 and 3 business days after, then the tagger is told once; opening stops them', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  seen(w, OZZ, VIC);
  await core(w, ADA, 'POST', 'tasks', { title: 'Call the church', owner_email: OZZ.email });
  const b = await core(w, ADA, 'POST', 'tasks', { title: 'Send the photos', owner_email: VIC.email });
  // Tagged Friday afternoon.
  w.d1.db.prepare("UPDATE hub_task_nudges SET tagged_at = '2026-10-09T19:00:00.000Z'").run();
  w.mail.length = 0;
  const { nudgePass } = await import('../functions/_lib/notify/nudges.ts');
  assert.equal((await nudgePass(w.env, new Date('2026-10-10T13:00:00Z'))).emails, 0, 'Saturday');
  assert.equal((await nudgePass(w.env, new Date('2026-10-12T11:00:00Z'))).emails, 0, 'Monday 7 AM is before the window');
  // Vic opens his task over the weekend.
  w.d1.db.prepare('INSERT INTO hub_task_seen (email, task_id, at) VALUES (?, ?, ?) ON CONFLICT(email, task_id) DO UPDATE SET at = excluded.at').run(VIC.email, b.data.task.id, '2026-10-10T15:00:00.000Z');
  const mon = await nudgePass(w.env, new Date('2026-10-12T13:00:00Z'));
  assert.equal(mon.first, 1);
  assert.equal(w.mail.length, 1);
  assert.equal(w.mail[0].to, OZZ.email);
  assert.equal(w.mail[0].subject, 'Did you see this? Ada tagged you in Call the church');
  assert.match(w.mail[0].text, /on Friday, October 9/);
  assert.equal((await nudgePass(w.env, new Date('2026-10-12T14:00:00Z'))).emails, 0, 'once a day');
  assert.equal((await nudgePass(w.env, new Date('2026-10-13T13:00:00Z'))).emails, 0, '2 business days: not yet');
  const wed = await nudgePass(w.env, new Date('2026-10-14T13:00:00Z'));
  assert.equal(wed.second, 1);
  assert.equal(w.mail.length, 2);
  const thu = await nudgePass(w.env, new Date('2026-10-15T13:00:00Z'));
  assert.equal(thu.told, 1);
  const told = rows(w, "SELECT * FROM hub_task_notices WHERE email = ? AND kind = 'unseen'", ADA.email);
  assert.equal(told.length, 1);
  assert.match(told[0].body, /Ozzy Other has not opened this since you tagged them on Friday, October 9/);
  assert.equal((await nudgePass(w.env, new Date('2026-10-16T13:00:00Z'))).emails, 0, 'stopped');
  assert.deepEqual(rows(w, 'SELECT email, done_why FROM hub_task_nudges ORDER BY email').map((r) => r.done_why), ['told', 'seen']);
});

test('opening the task through the route records it; a comment by the tagged person also stops nudges', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  seen(w, OZZ, DAN);
  const t = await core(w, ADA, 'POST', 'tasks', { title: 'Book the hall', owner_email: OZZ.email });
  const u = await core(w, ADA, 'POST', 'tasks', { title: 'Print the cards', owner_email: DAN.email });
  await core(w, OZZ, 'GET', `tasks/${t.data.task.id}`);
  await core(w, DAN, 'POST', `tasks/${u.data.task.id}/comments`, { body: 'On it.' });
  const { nudgePass } = await import('../functions/_lib/notify/nudges.ts');
  const r = await nudgePass(w.env, new Date(Date.now() + 5 * 86400000));
  assert.equal(r.closed, 2);
  assert.equal(r.emails, 0);
});

test('feedback: a fixed note with a reply is emailed once; a new reply is emailed again; held rows wait; notify.only holds the rest', async () => {
  const w = world();
  const ins = w.d1.db.prepare("INSERT INTO brain_feedback (at, email, name, source, rating, question, comment, status, reply, handled_by) VALUES (?, ?, ?, 'brain', 'wrong', ?, ?, ?, ?, ?)");
  ins.run(NOW, OZZ.email, OZZ.name, 'How many partners gave in September?', 'The number looked low.', 'fixed', 'Updated. It counts every partner now.', 'agent');
  ins.run(NOW, VIC.email, VIC.name, 'Old question', null, 'fixed', 'Old answer', ADA.email);
  w.d1.db.prepare("UPDATE brain_feedback SET reply_mailed = reply, reply_mailed_at = 'held' WHERE email = ?").run(VIC.email);
  // An agent marks a note fixed straight in D1 with no reply: it is emailed as "Updated." and the row reads the same.
  w.d1.db.prepare("INSERT INTO brain_feedback (at, email, name, source, comment, status) VALUES (?, ?, ?, 'hub', 'Slow page.', 'fixed')").run(NOW, VIC.email, VIC.name);
  const { feedbackPass } = await import('../functions/_lib/notify/feedback.ts');
  const r = await feedbackPass(w.env);
  assert.equal(r.sent, 2);
  assert.equal(rows(w, "SELECT reply FROM brain_feedback WHERE comment = 'Slow page.'")[0].reply, 'Updated.');
  assert.match(w.mail.find((x) => x.to === VIC.email).text, /My reply:\nUpdated\./);
  w.mail.splice(w.mail.findIndex((x) => x.to === VIC.email), 1);
  const m = w.mail[0];
  assert.equal(m.to, OZZ.email);
  assert.equal(m.subject, 'Updated: your Favor Brain question');
  assert.match(m.text, /How many partners gave in September\?/);
  assert.match(m.text, /Updated\. It counts every partner now\./);
  assert.match(m.text, /\/brain\/\?ask=How%20many%20partners/);
  assert.match(m.html, /Ask it again in FavorOS/);
  assert.equal(m.fromName, 'Will Hamilton via FavorOS');
  assert.doesNotMatch(m.html + m.text, /—|\bAI\b|donor/i);
  assert.equal((await feedbackPass(w.env)).sent, 0, 'once per reply');
  w.d1.db.prepare("UPDATE brain_feedback SET reply = 'Updated again.' WHERE email = ?").run(OZZ.email);
  assert.equal((await feedbackPass(w.env)).sent, 1, 'a new reply goes out');
  // A test hold: notify.only lets only the test account through.
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('notify.only', 'tester@favorintl.org', 't', ?)").run(NOW);
  const env2 = { ...w.env };
  ins.run(NOW, DAN.email, DAN.name, 'Q', null, 'fixed', 'A', ADA.email);
  const h = await feedbackPass(env2);
  assert.equal(h.skipped, 1);
  assert.equal(w.mail.length, 2);
});

test('markUpdated sets fixed, "Updated." and emails now', async () => {
  const w = world();
  w.d1.db.prepare("INSERT INTO brain_feedback (at, email, name, source, comment, status) VALUES (?, ?, ?, 'hub', 'The button is hidden.', 'new')").run(NOW, DAN.email, DAN.name);
  const { markUpdated } = await import('../functions/_lib/notify/feedback.ts');
  const r = await markUpdated(w.env, 1, { by: ADA.email });
  assert.equal(r.sent, 1);
  const row = rows(w, 'SELECT status, reply FROM brain_feedback')[0];
  assert.deepEqual({ ...row }, { status: 'fixed', reply: 'Updated.' });
  assert.equal(w.mail[0].subject, 'Updated: your FavorOS feedback');
  assert.equal(w.mail[0].fromName, 'Ada Admin via FavorOS');
  assert.match(w.mail[0].text, /Your feedback:\nThe button is hidden\./);
});
