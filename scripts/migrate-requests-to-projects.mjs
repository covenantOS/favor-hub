#!/usr/bin/env node
// Brings the request board into Projects. Every request becomes a card in its team's pipeline (Intake, Triage, In progress, Review,
// Done), keyed on the request id, so running it twice changes nothing the second time.
//
//   node scripts/migrate-requests-to-projects.mjs              dry run (the default): reads, prints what it would do, writes nothing
//   node scripts/migrate-requests-to-projects.mjs --apply      does the writes
//   --list                                                     also prints each request id with its stage (never titles)
//
// What happens to each request (requests table, the old board):
//   already has a hub_intake row                  skipped (migrated before)
//   declined                                      a hub_intake row, no card (the reason stays on the request)
//   already has a card (it was accepted)          a hub_intake row linking that card; the card stays in its project
//   everything else                               a new card in the team's pipeline: inbox is Intake, approved is Triage,
//                                                 in_progress is In progress, done is Done (ticked, with its finish time)
// A request about Marketing (surface 'marketing') goes to the Marketing pipeline, the rest to Tech. A pipeline project is made when a
// team has none: members-only, led by the person the staff directory names (same rule as functions/_lib/intake/pipeline.ts).
// The owner and due date come from request_tasks. Nothing is emailed, no notice is written, Asana is not touched (a pipeline is never
// synced), and attachments, comments and history stay where they are on the request.
//
// Needs the Marketing account environment: source Q:/work/favor-hub/cfenv.sh. Reads and writes go through wrangler d1 execute against
// favor-requests (the same way scripts/web-routes.mjs does). Apply db/projects-intake.sql first. No key is printed.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const STAGES = ['Intake', 'Triage', 'In progress', 'Review', 'Done'];
const STAGE_OF = { inbox: 'Intake', approved: 'Triage', in_progress: 'In progress', done: 'Done' };
const PROJECTS = {
  tech: { name: 'Tech requests', key: 'TRQ', team: 'Tech', color: 'sky', description: 'Requests for Tech, from Intake to Done. Accept a request into any project from its card.' },
  marketing: { name: 'Marketing requests', key: 'MRQ', team: 'Marketing', color: 'sun', description: 'Requests for Marketing, from Intake to Done. Accept a request into any project from its card.' },
};
const TESTERS = ['tester@favorintl.org', 'tester2@favorintl.org'];
const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
const lower = (s) => String(s || '').trim().toLowerCase();
const hex = (n = 12) => randomBytes(n).toString('hex');
const sq = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export const teamOf = (r) => (String(r.surface) === 'marketing' ? 'marketing' : 'tech');

/** Who leads a new pipeline: the staff directory by title, else the first FavorOS admin. Same rule as the server. */
export function pickLead(team, directory, admins) {
  const active = directory.filter((p) => p.active);
  let pick = null;
  if (team === 'tech') pick = (active.find((p) => /lead developer/i.test(p.title || '')) || active.find((p) => /developer/i.test(p.title || '')))?.email;
  else {
    const m = active.filter((p) => /marketing/i.test(p.team || ''));
    pick = (m.find((p) => /director|manager|lead/i.test(p.title || '')) || m[0])?.email;
  }
  if (pick && FAVOR.test(lower(pick))) return lower(pick);
  const a = admins.map(lower).find((e) => FAVOR.test(e) && !TESTERS.includes(e));
  return a || null;
}

/**
 * data: { requests, reqTasks (request_id -> {owner_email, due_date}), cards (request_id -> {id, project_id}), intake (Set of request ids),
 *         pipelines (team -> {project_id, key, next_num, sections: {name -> id}}), keys (Set of project keys), directory, admins }
 * Returns the plan: what each request gets, and which pipelines to make.
 */
export function planMigration(data) {
  const plan = { pipelines: [], items: [], skipped: 0, tests: 0, counts: {}, problems: [] };
  const make = {};
  for (const r of data.requests) {
    if (data.intake.has(r.id)) {
      plan.skipped++;
      continue;
    }
    // A test account's requests stay as they are: its My requests reads them, and its first triage makes the card in the test pipeline.
    if (TESTERS.includes(lower(r.submitter_email))) {
      plan.tests++;
      continue;
    }
    const team = teamOf(r);
    const card = data.cards.get(r.id);
    if (r.status === 'declined') {
      plan.items.push({ id: r.id, team, action: 'declined', stage: null, request: r });
      continue;
    }
    if (card) {
      plan.items.push({ id: r.id, team, action: 'link', stage: null, card: card.id, request: r });
      continue;
    }
    const stage = STAGE_OF[r.status] || 'Intake';
    plan.items.push({ id: r.id, team, action: 'card', stage, request: r });
    make[team] = true;
  }
  // A pipeline for each team that needs a card and has none yet; sections it lacks are added.
  for (const team of Object.keys(make)) {
    const have = data.pipelines.get(team);
    if (have) {
      const lacking = STAGES.filter((s) => !Object.keys(have.sections).some((n) => n.toLowerCase() === s.toLowerCase()));
      if (lacking.length) plan.pipelines.push({ team, existing: true, project_id: have.project_id, key: have.key, lacking });
      continue;
    }
    const lead = pickLead(team, data.directory, data.admins);
    if (!lead) {
      plan.problems.push(`No one can lead the ${team} pipeline: no matching person in the staff directory and no admin. ${team} requests were left out.`);
      plan.items = plan.items.filter((i) => !(i.team === team && i.action === 'card'));
      continue;
    }
    let key = PROJECTS[team].key;
    let n = 0;
    while (data.keys.has(key)) key = PROJECTS[team].key.slice(0, 4) + String.fromCharCode(65 + n++);
    plan.pipelines.push({ team, existing: false, project_id: 'prj_' + hex(), key, lead, lacking: [...STAGES] });
  }
  for (const i of plan.items) {
    const k = `${i.team}|${i.action === 'card' ? i.stage : i.action}`;
    plan.counts[k] = (plan.counts[k] || 0) + 1;
  }
  return plan;
}

const NOW = () => new Date().toISOString();

/** The SQL for a plan: one list of statements, each guarded so running it again does nothing. */
export function statementsFor(plan, data) {
  const out = [];
  const now = NOW();
  const pipe = {};
  for (const p of plan.pipelines) {
    const def = PROJECTS[p.team];
    if (!p.existing) {
      out.push(
        `INSERT INTO hub_projects (id, key, name, description, team, lead_email, visibility, status, color, next_num, created_by, created_at, updated_at) SELECT ${sq(p.project_id)}, ${sq(p.key)}, ${sq(def.name)}, ${sq(def.description)}, ${sq(def.team)}, ${sq(p.lead)}, 'members', 'active', ${sq(def.color)}, 1, ${sq(p.lead)}, ${sq(now)}, ${sq(now)} WHERE NOT EXISTS (SELECT 1 FROM hub_intake_teams WHERE team = ${sq(p.team)}) AND NOT EXISTS (SELECT 1 FROM hub_projects WHERE key = ${sq(p.key)})`,
        `INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) SELECT ${sq(p.project_id)}, ${sq(p.lead)}, 'lead', ${sq(now)} WHERE EXISTS (SELECT 1 FROM hub_projects WHERE id = ${sq(p.project_id)})`,
        `INSERT OR IGNORE INTO hub_intake_teams (team, project_id, created_at) SELECT ${sq(p.team)}, ${sq(p.project_id)}, ${sq(now)} WHERE EXISTS (SELECT 1 FROM hub_projects WHERE id = ${sq(p.project_id)})`
      );
    }
    const base = p.existing ? Math.max(0, ...Object.values(data.pipelines.get(p.team).sortOf || {})) : 0;
    p.lacking.forEach((s, i) => {
      out.push(
        `INSERT INTO hub_project_sections (id, project_id, name, sort) SELECT ${sq('sec_' + hex())}, t.project_id, ${sq(s)}, ${sq(p.existing ? base + (i + 1) * 1000 : (STAGES.indexOf(s) + 1) * 1000)} FROM hub_intake_teams t WHERE t.team = ${sq(p.team)} AND NOT EXISTS (SELECT 1 FROM hub_project_sections x WHERE x.project_id = t.project_id AND lower(x.name) = lower(${sq(s)}))`
      );
    });
    pipe[p.team] = true;
  }
  for (const it of plan.items) {
    const r = it.request;
    const rid = sq(it.id);
    if (it.action === 'card') {
      const rt = data.reqTasks.get(it.id) || {};
      const owner = FAVOR.test(lower(rt.owner_email)) ? lower(rt.owner_email) : null;
      const done = it.stage === 'Done';
      const proj = `(SELECT project_id FROM hub_intake_teams WHERE team = ${sq(it.team)})`;
      const guard = `NOT EXISTS (SELECT 1 FROM hub_tasks WHERE request_id = ${rid} AND status <> 'dropped')`;
      const by = `(SELECT lead_email FROM hub_projects WHERE id = ${proj})`;
      const body = `Request from ${r.submitter_name || r.submitter_email || 'someone'}: https://dash.favorintl.org/projects/?r=${encodeURIComponent(it.id)}\n\n${String(r.body || '').slice(0, 15000)}`.slice(0, 20000);
      out.push(
        `UPDATE hub_projects SET next_num = next_num + 1 WHERE id = ${proj} AND ${guard}`,
        `INSERT INTO hub_tasks (id, project_id, section_id, code, title, description, status, priority, owner_email, due_date, done_at, done_by, sort, request_id, created_by, created_at, updated_at)
         SELECT ${sq('tsk_' + hex())}, ${proj}, (SELECT id FROM hub_project_sections WHERE project_id = ${proj} AND lower(name) = lower(${sq(it.stage)}) ORDER BY sort LIMIT 1),
           (SELECT key || '-' || printf('%04d', next_num - 1) FROM hub_projects WHERE id = ${proj}),
           ${sq(String(r.title || 'Request').slice(0, 300))}, ${sq(body)}, ${sq(done ? 'done' : 'open')}, 'normal', ${sq(owner)}, ${sq(rt.due_date || null)},
           ${sq(done ? r.completed_at || r.updated_at : null)}, ${done ? by : 'NULL'},
           COALESCE((SELECT MAX(sort) FROM hub_tasks WHERE project_id = ${proj} AND section_id IS NOT NULL), 0) + 1024, ${rid}, ${by}, ${sq(r.created_at)}, ${sq(r.updated_at || r.created_at)}
         WHERE ${proj} IS NOT NULL AND ${guard}`
      );
    }
    const place = it.team === 'marketing' ? 'design' : (it.request?.surface || 'website');
    out.push(
      `INSERT OR IGNORE INTO hub_intake (request_id, task_id, team, kind, place, audience, needed, chips, migrated, created_at)
       SELECT ${rid}, ${it.action === 'declined' ? 'NULL' : `(SELECT id FROM hub_tasks WHERE request_id = ${rid} AND status <> 'dropped' ORDER BY created_at LIMIT 1)`}, ${sq(it.team)}, 'other', ${sq(place)}, '', '', '{}', 1, ${sq(now)}`
    );
    out.push(
      `INSERT INTO events (id, request_id, kind, actor, payload, created_at) SELECT ${sq('evt_' + hex())}, ${rid}, 'migrated', 'migration', ${sq(JSON.stringify({ to: 'projects', action: it.action, stage: it.stage }))}, ${sq(now)} WHERE NOT EXISTS (SELECT 1 FROM events WHERE request_id = ${rid} AND kind = 'migrated')`
    );
  }
  return out;
}

/** Reads everything the plan needs. q(sql) returns an array of row objects. Only SELECTs. */
export async function readData(q) {
  const tables = new Set((await q("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name));
  const need = ['requests', 'hub_tasks', 'hub_projects', 'hub_project_sections'];
  const missing = need.filter((t) => !tables.has(t));
  if (missing.length) return { missing };
  // The intake tables come from db/projects-intake.sql. A dry run may read a database that does not have them yet (everything is then
  // still to migrate); apply refuses until they exist.
  const pending = ['hub_intake', 'hub_intake_teams'].filter((t) => !tables.has(t));
  const requests = [];
  for (let off = 0; ; off += 200) {
    const page = await q(`SELECT id, title, body, surface, status, submitter_name, submitter_email, created_at, updated_at, completed_at FROM requests ORDER BY created_at, id LIMIT 200 OFFSET ${off}`);
    requests.push(...page);
    if (page.length < 200) break;
  }
  const reqTasks = new Map();
  if (tables.has('request_tasks')) for (const r of await q('SELECT request_id, owner_email, due_date FROM request_tasks')) reqTasks.set(r.request_id, r);
  const cards = new Map();
  for (const r of await q("SELECT request_id, id, project_id FROM hub_tasks WHERE request_id IS NOT NULL AND status <> 'dropped' ORDER BY created_at")) if (!cards.has(r.request_id)) cards.set(r.request_id, r);
  const intake = new Set(pending.includes('hub_intake') ? [] : (await q('SELECT request_id FROM hub_intake')).map((r) => r.request_id));
  const pipelines = new Map();
  for (const t of pending.includes('hub_intake_teams') ? [] : await q('SELECT t.team, t.project_id, p.key, p.next_num FROM hub_intake_teams t JOIN hub_projects p ON p.id = t.project_id')) {
    const secs = await q(`SELECT id, name, sort FROM hub_project_sections WHERE project_id = ${sq(t.project_id)}`);
    pipelines.set(t.team, { project_id: t.project_id, key: t.key, next_num: t.next_num, sections: Object.fromEntries(secs.map((s) => [s.name, s.id])), sortOf: Object.fromEntries(secs.map((s) => [s.name, s.sort])) });
  }
  const keys = new Set((await q('SELECT key FROM hub_projects')).map((r) => r.key));
  const directory = tables.has('meet_directory') ? await q('SELECT email, name, title, team, active FROM meet_directory') : [];
  const admins = tables.has('hub_users') ? (await q("SELECT email FROM hub_users WHERE role = 'admin' AND blocked = 0 ORDER BY created_at, email")).map((r) => r.email) : [];
  return { requests, reqTasks, cards, intake, pipelines, keys, directory, admins, pending };
}

export function report(plan, data, apply) {
  const lines = [];
  const total = data.requests.length;
  lines.push(`${apply ? 'APPLY' : 'DRY RUN'}: ${total} requests on the old board, ${plan.skipped} already migrated, ${plan.tests} from test accounts left alone, ${plan.items.length} to migrate.`);
  for (const p of plan.pipelines) lines.push(p.existing ? `  pipeline ${p.team} (${p.key}) exists; would add the sections: ${p.lacking.join(', ')}` : `  pipeline ${p.team}: would make project ${p.key} "${PROJECTS[p.team].name}" (members only), led by ${p.lead}`);
  for (const team of ['tech', 'marketing']) {
    const parts = [];
    for (const s of [...STAGES, 'link', 'declined']) {
      const n = plan.counts[`${team}|${s}`];
      if (n) parts.push(`${s === 'link' ? 'linked to the card it already has' : s === 'declined' ? 'declined (no card)' : 'new card in ' + s}: ${n}`);
    }
    lines.push(`  ${team}: ${parts.length ? parts.join(', ') : 'nothing'}`);
  }
  for (const pr of plan.problems) lines.push('  PROBLEM: ' + pr);
  return lines.join('\n');
}

/* ------------------------------------------------------------------------------------------------ wrangler */

function wranglerQuery(sql) {
  const out = execSync(`npx wrangler d1 execute favor-requests --remote --json --command ${JSON.stringify(sql)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out)[0].results || [];
}

function wranglerFile(statements, dir) {
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/migrate-${Date.now()}-${randomBytes(3).toString('hex')}.sql`;
  writeFileSync(file, statements.map((s) => s.replace(/;\s*$/, '') + ';').join('\n') + '\n');
  try {
    execSync(`npx wrangler d1 execute favor-requests --remote --file ${JSON.stringify(file)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } finally {
    rmSync(file, { force: true });
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const list = process.argv.includes('--list');
  if (!process.env.CLOUDFLARE_API_KEY || !process.env.CLOUDFLARE_EMAIL) throw new Error('Run: source Q:/work/favor-hub/cfenv.sh');
  const q = async (sql) => wranglerQuery(sql);
  const data = await readData(q);
  if (data.missing) {
    console.log(`Not ready: these tables are missing: ${data.missing.join(', ')}. Apply db/projects.sql and db/projects-intake.sql first.`);
    process.exit(2);
  }
  const plan = planMigration(data);
  console.log(report(plan, data, apply));
  if (list) for (const i of plan.items) console.log(`  ${i.id} ${i.team} ${i.action === 'card' ? i.stage : i.action}`);
  if (data.pending.length) console.log(`  NOTE: ${data.pending.join(' and ')} not in the database yet. Apply db/projects-intake.sql (wrangler d1 execute favor-requests --remote --file db/projects-intake.sql) before --apply.`);
  if (!apply) {
    console.log('Nothing was written. Run again with --apply to do it.');
    return;
  }
  if (data.pending.length) {
    console.log('Not applied: the intake tables are missing.');
    process.exit(2);
  }
  const statements = statementsFor(plan, data);
  const tmp = process.env.MIGRATE_TMP || 'Q:/Temp/Will/migrate-requests';
  for (let i = 0; i < statements.length; i += 100) wranglerFile(statements.slice(i, i + 100), tmp);
  console.log(`Wrote ${statements.length} statements. Run it again to confirm: it should say 0 to migrate.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e).replace(/[A-Za-z0-9_-]{30,}/g, '[hidden]'));
    process.exit(1);
  });
}
