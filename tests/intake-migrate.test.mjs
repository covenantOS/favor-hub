// scripts/migrate-requests-to-projects.mjs on an in-memory copy of the board: what the dry run plans, what apply writes, and that a second
// run changes nothing. The script talks to Cloudflare only in main(); everything tested here is the pure part. Made-up requests only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { DESIGN, NOW, OUTSIDER, VIDEO, WILL, ic, iw, pc, rows } from './support/intake-world.mjs';

const M = await import('../scripts/migrate-requests-to-projects.mjs');

const q = (w) => async (sql) => w.d1.db.prepare(sql).all();
const add = (w, id, status, o = {}) =>
  w.d1.db
    .prepare(`INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at, approved_at, started_at, completed_at, declined_reason) VALUES (?, ?, ?, ?, ?, ?, ?, 'form', ?, ?, ?, ?, ?, ?)`)
    .run(id, o.title || `Request ${id}`, o.body || `Words of ${id}. It's "quoted"; semicolons; and\nnew lines.`, o.surface || 'website', status, o.name || 'Vic Video', o.email || VIDEO.email, o.at || '2026-09-20T10:00:00.000Z', o.at || '2026-09-20T10:00:00.000Z', null, null, status === 'done' ? '2026-10-01T10:00:00.000Z' : null, status === 'declined' ? 'Not now' : null);

function seed(w) {
  add(w, 'req_in1', 'inbox');
  add(w, 'req_in2', 'inbox', { surface: 'portal', email: OUTSIDER.email, name: 'Ozzy', title: "O'Brien's request" });
  add(w, 'req_ap1', 'approved');
  add(w, 'req_ip1', 'in_progress');
  add(w, 'req_dn1', 'done');
  add(w, 'req_dc1', 'declined');
  add(w, 'req_mk1', 'inbox', { surface: 'marketing' });
  add(w, 'req_acc', 'approved'); // accepted before: it already has a card in a project
  add(w, 'req_tst', 'inbox', { email: 'tester@favorintl.org', name: 'FavorOS Tester' });
  w.d1.db.prepare('INSERT INTO request_tasks (request_id, owner_email, due_date, updated_at) VALUES (?, ?, ?, ?)').run('req_ap1', DESIGN.email, '2026-10-30', NOW);
  w.d1.db.prepare('INSERT INTO request_tasks (request_id, owner_email, due_date, updated_at) VALUES (?, ?, ?, ?)').run('req_ip1', 'gone@favorintl.org', null, NOW);
  w.d1.db.prepare("INSERT INTO hub_projects (id, key, name, lead_email, created_by, created_at, updated_at) VALUES ('prj_old', 'OLD', 'Old project', ?, ?, ?, ?)").run(WILL.email, WILL.email, NOW, NOW);
  w.d1.db.prepare("INSERT INTO hub_tasks (id, project_id, code, title, status, owner_email, request_id, created_by, created_at, updated_at) VALUES ('tsk_old', 'prj_old', 'OLD-0001', 'Accepted one', 'open', ?, 'req_acc', ?, ?, ?)").run(DESIGN.email, WILL.email, NOW, NOW);
}

async function run(w) {
  const data = await M.readData(q(w));
  const plan = M.planMigration(data);
  for (const s of M.statementsFor(plan, data)) w.d1.exec(s.replace(/;\s*$/, '') + ';');
  return { data, plan };
}

test('the plan: per team and stage, with the old board\'s statuses mapped to the pipeline', async () => {
  const w = iw();
  seed(w);
  const data = await M.readData(q(w));
  assert.equal(data.missing, undefined);
  const plan = M.planMigration(data);
  assert.deepEqual(plan.counts, {
    'tech|Intake': 2,
    'tech|Triage': 1,
    'tech|In progress': 1,
    'tech|Done': 1,
    'tech|declined': 1,
    'tech|link': 1,
    'marketing|Intake': 1,
  });
  assert.deepEqual(plan.pipelines.map((p) => [p.team, p.key, p.existing, p.lead]).sort(), [['marketing', 'MRQ', false, DESIGN.email], ['tech', 'TRQ', false, WILL.email]]);
  assert.match(M.report(plan, data, false), /DRY RUN: 9 requests on the old board, 0 already migrated, 1 from test accounts left alone, 8 to migrate\./);
  assert.match(M.report(plan, data, false), /tech: new card in Intake: 2, new card in Triage: 1/);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_intake')[0].n, 0, 'planning writes nothing');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_projects')[0].n, 1);
});

test('apply writes the cards, the pipelines and the links; a second run finds nothing to do', async () => {
  const w = iw();
  seed(w);
  await run(w);
  const card = (id) => rows(w, 'SELECT t.*, s.name AS sec, p.key AS pkey FROM hub_tasks t LEFT JOIN hub_project_sections s ON s.id = t.section_id JOIN hub_projects p ON p.id = t.project_id WHERE t.request_id = ?', id)[0];
  assert.equal(card('req_in1').sec, 'Intake');
  assert.equal(card('req_in1').pkey, 'TRQ');
  assert.equal(card('req_in1').status, 'open');
  assert.equal(card('req_ap1').sec, 'Triage');
  assert.equal(card('req_ap1').owner_email, DESIGN.email);
  assert.equal(card('req_ap1').due_date, '2026-10-30');
  assert.equal(card('req_ip1').sec, 'In progress');
  assert.equal(card('req_ip1').owner_email, 'gone@favorintl.org', 'an owner who has since left is kept as recorded, not guessed away');
  assert.equal(card('req_dn1').sec, 'Done');
  assert.equal(card('req_dn1').status, 'done');
  assert.equal(card('req_dn1').done_at, '2026-10-01T10:00:00.000Z');
  assert.equal(card('req_mk1').pkey, 'MRQ');
  assert.equal(card('req_mk1').sec, 'Intake');
  assert.equal(card('req_dc1'), undefined, 'a declined request gets no card');
  assert.equal(card('req_acc').pkey, 'OLD', 'an accepted request keeps its card where it is');
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM hub_tasks WHERE request_id = 'req_acc'")[0].n, 1);
  assert.equal(card('req_in2').title, "O'Brien's request");
  assert.match(card('req_in1').description, /\nWords of req_in1\. It's "quoted"; semicolons; and\nnew lines\./);
  assert.match(card('req_in1').description, /^Request from Vic Video: https:\/\/dash\.favorintl\.org\/projects\/\?r=req_in1\n/);
  // Codes are in order and unique.
  const codes = rows(w, "SELECT code FROM hub_tasks WHERE project_id IN (SELECT id FROM hub_projects WHERE key IN ('TRQ', 'MRQ')) ORDER BY code").map((r) => r.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.includes('TRQ-0001') && codes.includes('MRQ-0001'));
  assert.equal(rows(w, "SELECT next_num FROM hub_projects WHERE key = 'TRQ'")[0].next_num, 6, 'five Tech cards, so the next code is six');
  // A test account's request is left alone: no card, no intake row.
  assert.equal(card('req_tst'), undefined);
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM hub_intake WHERE request_id = 'req_tst'")[0].n, 0);
  assert.equal(card('req_in1').created_by, WILL.email);
  // Intake rows: one per request, flagged as migrated.
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_intake WHERE migrated = 1')[0].n, 8);
  assert.equal(rows(w, "SELECT task_id FROM hub_intake WHERE request_id = 'req_dc1'")[0].task_id, null);
  assert.equal(rows(w, "SELECT task_id FROM hub_intake WHERE request_id = 'req_acc'")[0].task_id, 'tsk_old');
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM events WHERE kind = 'migrated'")[0].n, 8);
  // Nothing was told: no notices, no mail, no chat cards.
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM request_notices')[0].n, 0);
  assert.equal(w.mail.length, 0);

  const before = {
    tasks: rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks')[0].n,
    projects: rows(w, 'SELECT COUNT(*) AS n FROM hub_projects')[0].n,
    sections: rows(w, 'SELECT COUNT(*) AS n FROM hub_project_sections')[0].n,
    intake: rows(w, 'SELECT COUNT(*) AS n FROM hub_intake')[0].n,
    next: rows(w, "SELECT next_num FROM hub_projects WHERE key = 'TRQ'")[0].next_num,
  };
  const second = await run(w);
  assert.equal(second.plan.items.length, 0, 'nothing left to migrate');
  assert.equal(second.plan.skipped, 8);
  assert.equal(second.plan.pipelines.length, 0);
  assert.match(M.report(second.plan, second.data, false), /8 already migrated, 1 from test accounts left alone, 0 to migrate/);
  assert.deepEqual(
    {
      tasks: rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks')[0].n,
      projects: rows(w, 'SELECT COUNT(*) AS n FROM hub_projects')[0].n,
      sections: rows(w, 'SELECT COUNT(*) AS n FROM hub_project_sections')[0].n,
      intake: rows(w, 'SELECT COUNT(*) AS n FROM hub_intake')[0].n,
      next: rows(w, "SELECT next_num FROM hub_projects WHERE key = 'TRQ'")[0].next_num,
    },
    before
  );
  // Running the very same statements again (a crash halfway and a re-run) also changes nothing.
  const data = await M.readData(q(w));
  w.d1.db.prepare('DELETE FROM hub_intake').run();
  const replay = await M.readData(q(w));
  assert.equal(replay.intake.size, 0);
  const plan = M.planMigration(replay);
  for (const s of M.statementsFor(plan, replay)) w.d1.exec(s.replace(/;\s*$/, '') + ';');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks')[0].n, before.tasks, 'cards are found by request id, never made twice');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_intake')[0].n, 8);
  void data;
});

test('after the migration the new screens read the old requests: My requests, the queue and triage all work', async () => {
  const w = iw();
  seed(w);
  await run(w);
  const mine = (await ic(w, VIDEO, 'GET', 'mine')).data.requests;
  assert.deepEqual(mine.map((r) => [r.id, r.word, r.stage]).sort(), [['req_acc', 'Approved', null], ['req_ap1', 'Approved', 'Triage'], ['req_dc1', 'Declined', null], ['req_dn1', 'Done', 'Done'], ['req_in1', 'Sent', 'Intake'], ['req_ip1', 'In progress', 'In progress'], ['req_mk1', 'Sent', 'Intake']].sort());
  assert.equal(mine.find((r) => r.id === 'req_dc1').declined_reason, 'Not now');
  const queue = (await ic(w, WILL, 'GET', 'queue')).data.requests.map((r) => r.id).sort();
  assert.deepEqual(queue, ['req_in1', 'req_in2', 'req_mk1'], 'Intake holds the Sent requests of every team an admin triages, and not the test account\'s');
  assert.deepEqual((await ic(w, DESIGN, 'GET', 'queue')).data.requests.map((r) => r.id), ['req_mk1']);
  // A migrated card can be triaged.
  const a = await ic(w, WILL, 'POST', 'r/req_in1/accept', { owner_email: DESIGN.email });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.request.stage, 'Triage');
  // The test account's request has no card on the real board, and its first triage by a test account makes one in the test pipeline.
  const board = await pc(w, WILL, 'GET', 'tasks?project=TRQ&status=all');
  assert.ok(!board.data.tasks.some((t) => t.request_id === 'req_tst'));
  assert.equal((await ic(w, WILL, 'GET', 'r/req_tst')).status, 404);
});

test('a team with no one to lead its pipeline is reported, not guessed', async () => {
  const w = iw();
  add(w, 'req_mk1', 'inbox', { surface: 'marketing' });
  w.d1.db.prepare("UPDATE meet_directory SET active = 0 WHERE team = 'Marketing'").run();
  w.d1.db.prepare("DELETE FROM hub_users WHERE role = 'admin'").run();
  const plan = M.planMigration(await M.readData(q(w)));
  assert.equal(plan.items.length, 0);
  assert.match(plan.problems[0], /No one can lead the marketing pipeline/);
});

test('the dry run is the default and the script holds no key', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scripts/migrate-requests-to-projects.mjs', import.meta.url), 'utf8');
  assert.match(src, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.match(src, /if \(!apply\) \{[\s\S]*?return;/);
  assert.ok(!/CLOUDFLARE_API_KEY\s*=\s*['"]/.test(src));
  assert.ok(!src.includes(String.fromCharCode(8212)), 'no long dash');
  const bare = await M.readData(async (sql) => (sql.includes('sqlite_master') ? [{ name: 'requests' }] : []));
  assert.ok(bare.missing.includes('hub_tasks'), 'a database without Projects says so instead of failing');
  // A dry run reads a database that does not have the intake tables yet: every request is still to migrate, and apply refuses.
  const w = iw();
  seed(w);
  w.d1.exec('DROP TABLE hub_intake; DROP TABLE hub_intake_teams;');
  const early = await M.readData(q(w));
  assert.deepEqual(early.pending, ['hub_intake', 'hub_intake_teams']);
  assert.equal(M.planMigration(early).items.length, 8);
  assert.match(src, /if \(data\.pending\.length\) \{\r?\n    console\.log\('Not applied/);
});
