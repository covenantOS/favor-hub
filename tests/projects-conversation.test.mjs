// Projects: comments and @mentions, notices behind requests.notify, files, followers and collaborators, dependencies.
// Nobody real is ever told: the notice switch is off unless a test turns it on for made-up people.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADA, DAN, FLO, OZZY, VIC, call, seedProject, seedTask, world } from './projects-support.mjs';

async function setup(opts) {
  const w = world(opts);
  await seedProject(w);
  return w;
}
const notices = (w, email) => w.rows('SELECT kind, actor_email, task_id, body, read_at FROM hub_task_notices WHERE email = ? ORDER BY created_at, id', email);

test('a comment: author, body, mentions by <@email> or by list, the mentioned and the commenter follow', async () => {
  const w = await setup();
  const t = await seedTask(w, VIC, { owner_email: DAN.email });
  const r = await call(w, VIC, 'POST', `tasks/${t.id}/comments`, { body: `Can you check this, <@${OZZY.email}>? Also ${FLO.email}`, mentions: [FLO.email, 'ghost@favorintl.org'] });
  assert.equal(r.status, 201);
  assert.equal(r.data.comment.author.name, VIC.name);
  assert.deepEqual(r.data.comment.mentions.sort(), [FLO.email, OZZY.email], 'tokens and the list, only people on the staff list');
  const people = w.rows('SELECT email, role FROM hub_task_people WHERE task_id = ? ORDER BY email', t.id);
  assert.deepEqual(people.map((p) => p.email), [FLO.email, OZZY.email, VIC.email]);
  assert.ok(people.every((p) => p.role === 'follower'));
  const d = (await call(w, OZZY, 'GET', `tasks/${t.id}`)).data;
  assert.equal(d.comments.length, 1, 'the mentioned person can read it');
  assert.equal(d.task.comments, 1);
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/comments`, { body: '  ' })).data.error, 'empty');
});

test('comment rules: anyone who can see the task may comment; edit your own; delete your own, or as lead or admin', async () => {
  const w = await setup();
  await seedProject(w, { name: 'Private', key: 'PRV', visibility: 'members', members: [VIC.email] });
  const hidden = (await call(w, VIC, 'POST', 'tasks', { title: 'Hidden', project_id: 'PRV' })).data.task;
  assert.equal((await call(w, OZZY, 'POST', `tasks/${hidden.id}/comments`, { body: 'hi' })).status, 404);
  const t = await seedTask(w, VIC);
  const c = (await call(w, OZZY, 'POST', `tasks/${t.id}/comments`, { body: 'I am not on the project but I can see it' })).data.comment;
  assert.equal((await call(w, DAN, 'PATCH', `tasks/${t.id}/comments/${c.id}`, { body: 'x' })).status, 403);
  const ed = await call(w, OZZY, 'PATCH', `tasks/${t.id}/comments/${c.id}`, { body: 'Edited' });
  assert.equal(ed.data.comment.body, 'Edited');
  assert.ok(ed.data.comment.edited_at);
  assert.equal((await call(w, OZZY, 'PATCH', `tasks/${t.id}/comments/${c.id}`, { body: '' })).status, 400);
  assert.equal((await call(w, DAN, 'DELETE', `tasks/${t.id}/comments/${c.id}`)).status, 403);
  assert.equal((await call(w, ADA, 'DELETE', `tasks/${t.id}/comments/${c.id}`)).status, 200, 'the project lead');
  const after = (await call(w, VIC, 'GET', `tasks/${t.id}`)).data;
  assert.equal(after.comments.length, 0);
  assert.equal((await call(w, ADA, 'DELETE', `tasks/${t.id}/comments/${c.id}`)).status, 404);
});

test('notices stay off while requests.notify is off: nothing is written, nobody is told', async () => {
  const w = await setup();
  const t = await seedTask(w, VIC, { owner_email: DAN.email });
  const r = await call(w, VIC, 'POST', `tasks/${t.id}/comments`, { body: `hello <@${OZZY.email}>` });
  assert.deepEqual(r.data.told, []);
  await call(w, VIC, 'PATCH', `tasks/${t.id}`, { owner_email: OZZY.email, waiting_on_email: FLO.email });
  assert.equal(w.rows('SELECT COUNT(*) AS n FROM hub_task_notices')[0].n, 0);
  // The history still records everything.
  assert.ok((await call(w, VIC, 'GET', `tasks/${t.id}`)).data.events.length >= 3);
  const d = (await call(w, VIC, 'GET', `tasks/${t.id}`)).data;
  assert.equal(d.told[OZZY.email], false, 'the drawer can say this person will not be told');
});

test('requests.notify.only lists the addresses that are told while the switch is off', async () => {
  const w = await setup({ only: `${DAN.email}, ${FLO.email}` });
  const t = await seedTask(w, VIC, { owner_email: DAN.email });
  assert.equal(notices(w, DAN.email).length, 1, 'assigned');
  await call(w, VIC, 'POST', `tasks/${t.id}/comments`, { body: `look <@${FLO.email}> <@${OZZY.email}>` });
  assert.deepEqual(notices(w, FLO.email).map((n) => n.kind), ['mentioned']);
  assert.equal(notices(w, OZZY.email).length, 0, 'not on the list');
  assert.equal((await call(w, VIC, 'GET', `tasks/${t.id}`)).data.told[DAN.email], true);
});

test('with the switch on: assigned, mentioned, comment, waiting and done notices; the actor is never told; one per person', async () => {
  const w = await setup({ notify: 'on' });
  const t = await seedTask(w, VIC, { owner_email: DAN.email, followers: [FLO.email] });
  assert.deepEqual(notices(w, DAN.email).map((n) => n.kind), ['assigned']);
  assert.equal(notices(w, VIC.email).length, 0);
  // Ozzy comments, naming Flo: Flo is mentioned, Dan (owner) hears a comment, Vic is not on the task so is not told.
  await call(w, OZZY, 'POST', `tasks/${t.id}/comments`, { body: `Question for <@${FLO.email}>` });
  assert.deepEqual(notices(w, FLO.email).map((n) => n.kind), ['followed', 'mentioned'], 'added as a follower by Vic, then the mention (no comment notice on top)');
  assert.deepEqual(notices(w, DAN.email).map((n) => n.kind), ['assigned', 'comment']);
  assert.equal(notices(w, OZZY.email).length, 0);
  await call(w, DAN, 'PATCH', `tasks/${t.id}`, { waiting_on_email: FLO.email });
  assert.deepEqual(notices(w, FLO.email).map((n) => n.kind), ['followed', 'mentioned', 'waiting']);
  await call(w, DAN, 'PATCH', `tasks/${t.id}`, { owner_email: VIC.email });
  assert.deepEqual(notices(w, VIC.email).map((n) => n.kind), ['assigned']);
  const before = w.rows('SELECT COUNT(*) AS n FROM hub_task_notices')[0].n;
  await call(w, VIC, 'PATCH', `tasks/${t.id}`, { owner_email: VIC.email });
  assert.equal(w.rows('SELECT COUNT(*) AS n FROM hub_task_notices')[0].n, before, 'assigning to yourself tells nobody');
  await call(w, DAN, 'PATCH', `tasks/${t.id}`, { done: true });
  const done = notices(w, VIC.email).map((n) => n.kind);
  assert.ok(done.includes('done'), 'the owner and the maker hear it is done');
  assert.equal(notices(w, DAN.email).filter((n) => n.kind === 'done').length, 0, 'Dan finished it himself');
});

test('read your notices: list with task context, mark some or all read, only your own', async () => {
  const w = await setup({ notify: 'on' });
  const t = await seedTask(w, VIC, { owner_email: DAN.email, title: 'Pick the hero photo' });
  await seedTask(w, VIC, { owner_email: DAN.email, title: 'Second' });
  const list = (await call(w, DAN, 'GET', 'tasks/notices')).data;
  assert.equal(list.unread, 2);
  assert.equal(list.notices[0].title, 'Second');
  assert.equal(list.notices[1].code, 'MKT-0001');
  assert.equal(list.notices[1].project_key, 'MKT');
  assert.equal((await call(w, DAN, 'POST', 'tasks/notices/read', {})).status, 400, 'say which');
  const one = await call(w, DAN, 'POST', 'tasks/notices/read', { ids: [list.notices[0].id] });
  assert.equal(one.data.unread, 1);
  const other = await call(w, VIC, 'POST', 'tasks/notices/read', { all: true });
  assert.equal(other.data.unread, 0);
  assert.equal((await call(w, DAN, 'GET', 'tasks/notices')).data.unread, 1, 'Vic cannot clear Dan\'s');
  const all = await call(w, DAN, 'POST', 'tasks/notices/read', { all: true });
  assert.equal(all.data.unread, 0);
  assert.equal(all.data.notices.length, 2, 'read ones stay in the list for a week');
  void t;
});

test('the due-soon sweep tells owners once a day', async () => {
  const w = await setup({ notify: 'on' });
  const { dueSoonSweep } = await import('../functions/_lib/projects/notices.ts');
  await seedTask(w, VIC, { owner_email: DAN.email, due_date: '2026-10-12' });
  await seedTask(w, VIC, { owner_email: DAN.email, due_date: '2026-10-13' });
  await seedTask(w, VIC, { owner_email: DAN.email, due_date: '2026-10-20' });
  const done = await seedTask(w, VIC, { owner_email: FLO.email, due_date: '2026-10-12' });
  await call(w, VIC, 'PATCH', `tasks/${done.id}`, { done: true });
  const today = new Date().toISOString().slice(0, 10);
  w.d1.db.prepare(`DELETE FROM hub_task_notices`).run();
  assert.equal(await dueSoonSweep(w.env, '2026-10-12', '2026-10-13'), 2);
  assert.equal(await dueSoonSweep(w.env, '2026-10-12', '2026-10-13'), 0, 'a second run the same day adds nothing');
  assert.ok(today);
});

test('files: links, Drive and clip references, uploads with a download, and removal', async () => {
  const w = await setup();
  const t = await seedTask(w, VIC);
  const link = await call(w, VIC, 'POST', `tasks/${t.id}/files`, { kind: 'link', name: 'Brief', url: 'https://example.org/brief' });
  assert.equal(link.status, 201);
  assert.equal(link.data.file.added_by, VIC.email);
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/files`, { kind: 'link', name: 'Bad', url: 'javascript:alert(1)' })).data.error, 'bad_url');
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/files`, { kind: 'link', name: 'Bad', url: '' })).data.error, 'bad_url');
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/files`, { kind: 'drive', name: 'Photo', url: 'https://drive.google.com/file/d/abc', ref_id: 'abc' })).status, 201);
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/files`, { kind: 'clip', name: 'Walkthrough', ref_id: 'c0ffee' })).status, 201);
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/files`, { kind: 'drive', name: 'Empty' })).data.error, 'missing_field');
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/files`, { kind: 'upload', name: 'x' })).data.error, 'bad_kind');
  assert.equal((await call(w, OZZY, 'POST', `tasks/${t.id}/files`, { kind: 'link', name: 'No', url: 'https://x.org' })).status, 403);
  const form = new FormData();
  form.append('file', new File(['hello world'], 'Hero shot (final).png', { type: 'image/png' }));
  const up = await call(w, VIC, 'POST', `tasks/${t.id}/upload`, form);
  assert.equal(up.status, 201);
  assert.equal(up.data.file.name, 'Hero shot _final_.png', 'odd characters in a file name are replaced');
  assert.equal(up.data.file.size, 11);
  assert.match([...w.store.keys()][0], new RegExp(`^projects/${t.id}/fil_`));
  const dl = await call(w, OZZY, 'GET', `tasks/${t.id}/files/${up.data.file.id}/download`);
  assert.equal(dl.status, 200, 'anyone who can see the task can download');
  assert.equal(dl.res.headers.get('content-disposition').startsWith('attachment;'), true);
  assert.equal(dl.res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await dl.res.text(), 'hello world');
  const d = (await call(w, VIC, 'GET', `tasks/${t.id}`)).data;
  assert.equal(d.files.length, 4);
  assert.equal(d.task.files, 4);
  const big = new FormData();
  big.append('file', new File([new Uint8Array(26 * 1024 * 1024)], 'big.bin'));
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/upload`, big)).status, 413);
  assert.equal((await call(w, VIC, 'POST', `tasks/${t.id}/upload`, new FormData())).status, 400);
  assert.equal((await call(w, OZZY, 'DELETE', `tasks/${t.id}/files/${up.data.file.id}`)).status, 403);
  assert.equal((await call(w, VIC, 'DELETE', `tasks/${t.id}/files/${up.data.file.id}`)).status, 200);
  assert.equal(w.store.size, 0, 'the stored copy goes too');
});

test('people on a task: collaborators and followers; anyone who can see it may follow it themselves', async () => {
  const w = await setup({ notify: 'on' });
  const t = await seedTask(w, VIC, { owner_email: VIC.email });
  const add = await call(w, VIC, 'PUT', `tasks/${t.id}/people`, { add: [{ email: DAN.email, role: 'collab' }, { email: FLO.email }] });
  assert.equal(add.status, 200);
  assert.deepEqual(add.data.people.map((p) => [p.email, p.role]).sort(), [[DAN.email, 'collab'], [FLO.email, 'follower']]);
  assert.deepEqual(notices(w, DAN.email).map((n) => n.kind), ['assigned'], 'a collaborator hears they were added');
  assert.deepEqual(notices(w, FLO.email).map((n) => n.kind), ['followed'], 'a follower added by someone else is told (2026-10-14)');
  assert.equal((await call(w, OZZY, 'PUT', `tasks/${t.id}/people`, { add: [{ email: FLO.email, role: 'collab' }] })).status, 403);
  const self = await call(w, OZZY, 'PUT', `tasks/${t.id}/people`, { add: [{ email: OZZY.email, role: 'follower' }] });
  assert.equal(self.status, 200, 'follow yourself');
  const unfollow = await call(w, OZZY, 'PUT', `tasks/${t.id}/people`, { remove: [{ email: OZZY.email, role: 'follower' }] });
  assert.ok(!unfollow.data.people.some((p) => p.email === OZZY.email));
  assert.equal((await call(w, VIC, 'PUT', `tasks/${t.id}/people`, { add: [{ email: 'ghost@favorintl.org', role: 'collab' }] })).data.error, 'unknown_person');
  assert.equal((await call(w, VIC, 'PUT', `tasks/${t.id}/people`, { add: [{ email: DAN.email, role: 'boss' }] })).status, 400);
  // A collaborator on a task in a project they are not on can edit that task.
  await call(w, VIC, 'PUT', `tasks/${t.id}/people`, { add: [{ email: OZZY.email, role: 'collab' }] });
  assert.equal((await call(w, OZZY, 'PATCH', `tasks/${t.id}`, { priority: 'high' })).status, 200);
  const detail = (await call(w, VIC, 'GET', `tasks/${t.id}`)).data;
  assert.equal(detail.people.find((p) => p.email === VIC.email).role, 'owner');
  assert.equal(detail.told[FLO.email], true);
});

test('dependencies: finish to start, no cycles, no self, only tasks you can see', async () => {
  const w = await setup();
  const a = await seedTask(w, VIC, { title: 'A' });
  const b = await seedTask(w, VIC, { title: 'B' });
  const c = await seedTask(w, VIC, { title: 'C' });
  const ok = await call(w, VIC, 'PUT', `tasks/${b.id}/deps`, { add: [a.code] });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.deps.blockedBy[0].code, 'MKT-0001');
  await call(w, VIC, 'PUT', `tasks/${c.id}/deps`, { add: [b.id] });
  const d = (await call(w, VIC, 'GET', `tasks/${a.id}`)).data.deps;
  assert.deepEqual(d.blocks.map((x) => x.code), ['MKT-0002']);
  assert.equal((await call(w, VIC, 'PUT', `tasks/${a.id}/deps`, { add: [c.id] })).data.error, 'cycle', 'A to C to B to A');
  assert.equal((await call(w, VIC, 'PUT', `tasks/${a.id}/deps`, { add: [b.id] })).data.error, 'cycle');
  assert.equal((await call(w, VIC, 'PUT', `tasks/${a.id}/deps`, { add: [a.id] })).data.error, 'cycle');
  assert.equal((await call(w, OZZY, 'PUT', `tasks/${a.id}/deps`, { add: [b.id] })).status, 403);
  assert.equal(w.rows('SELECT COUNT(*) AS n FROM hub_task_deps')[0].n, 2);
  const rm = await call(w, VIC, 'PUT', `tasks/${b.id}/deps`, { remove: [a.code] });
  assert.deepEqual(rm.data.deps.blockedBy, []);
  assert.equal((await call(w, VIC, 'PUT', `tasks/${a.id}/deps`, { add: [c.id] })).status, 200, 'with the middle link gone it is allowed');
  await seedProject(w, { name: 'Private', key: 'PRV', visibility: 'members', members: [FLO.email] });
  const hidden = (await call(w, FLO, 'POST', 'tasks', { title: 'Hidden', project_id: 'PRV' })).data.task;
  assert.equal((await call(w, VIC, 'PUT', `tasks/${a.id}/deps`, { add: [hidden.id] })).status, 404, 'a task you cannot see is not there');
});

test('a task made from a project task moves its history with it: events list newest first, capped', async () => {
  const w = await setup();
  const t = await seedTask(w, VIC);
  for (let i = 0; i < 5; i++) await call(w, VIC, 'PATCH', `tasks/${t.id}`, { priority: i % 2 ? 'low' : 'high' });
  const ev = (await call(w, VIC, 'GET', `tasks/${t.id}`)).data.events;
  assert.equal(ev.length, 6);
  assert.equal(ev[ev.length - 1].kind, 'created');
  assert.deepEqual(ev[0].detail.to, { priority: 'high' });
  void ADA;
});
