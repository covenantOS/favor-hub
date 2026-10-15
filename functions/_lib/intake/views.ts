// Who may read which request, and the lists built from that. The rules, in full:
//   the person who asked reads their own requests and nothing else of anyone's (My requests, and the one request by its id);
//   the owners of a team's pipeline (its project's members and lead) and FavorOS admins read that team's requests (the queue, the request);
//   a test account's requests are read by the test accounts alone, as with every test row in Projects;
//   nobody else reads any request through these routes. The old board's open reading (/api/requests) is not widened or used here.
import { HttpError, type Env } from '../http';
import { getRequest, type RequestRow } from '../db';
import { isTester, TESTERS } from '../testuser';
import { projectStanding } from '../projects/access';
import { listProjects } from '../projects/projects';
import { lower, placeholders, sectionsOf, type ProjectRow } from '../projects/db';
import { syncedProject } from '../projects/sync';
import type { Actor } from '../requests/tasks';
import { PIPELINE_TEAMS, stageOf, type IntakeAcceptTarget, type IntakeItem, type IntakeStanding, type IntakeTeam, type PipelineTeam } from '../../../shared/intake-model';
import { teamLabel } from '../../../shared/request-parse';
import { intakeRow, type IntakeRow } from './card';
import { buildItems } from './items';
import { pipelineIds, pipelineIfAny } from './pipeline';

const TEST_LIST = TESTERS.map((e) => `'${e}'`).join(', ');

/** The team a request belongs to when it has no hub_intake row yet (an old request not brought over). */
export const legacyTeam = (row: Pick<RequestRow, 'surface'>): PipelineTeam => (String(row.surface) === 'marketing' ? 'marketing' : 'tech');

/** The pipeline this person works in for a team: a test account works in the test pipeline when there is one. */
async function pipelineFor(env: Env, actor: Actor, team: PipelineTeam) {
  if (isTester(actor.email)) {
    const t = await pipelineIfAny(env, team, true).catch(() => null);
    if (t) return t;
  }
  return pipelineIfAny(env, team).catch(() => null);
}

/** True when the person owns this team's pipeline: a member of its project, the lead, or a FavorOS admin. A pipeline not made yet is the admins'. */
export async function canTriage(env: Env, actor: Actor, team: PipelineTeam): Promise<boolean> {
  const pipe = await pipelineFor(env, actor, team);
  if (!pipe) return actor.admin;
  return (await projectStanding(env, actor, pipe.project)).edit;
}

/** The teams this person triages, among those that have a pipeline. */
export async function triageTeams(env: Env, actor: Actor): Promise<PipelineTeam[]> {
  const out: PipelineTeam[] = [];
  for (const t of PIPELINE_TEAMS) if ((await pipelineFor(env, actor, t)) && (await canTriage(env, actor, t))) out.push(t);
  return out;
}

export async function standingFor(env: Env, actor: Actor, row: RequestRow, intake: IntakeRow | null): Promise<IntakeStanding> {
  const team = intake?.team || legacyTeam(row);
  return { submitter: !!row.submitter_email && lower(row.submitter_email) === actor.email, triage: await canTriage(env, actor, team) };
}

/** The request when this person may read it, else a 404 that does not say whether it exists. */
export async function readableRequest(env: Env, actor: Actor, id: string): Promise<{ row: RequestRow; intake: IntakeRow | null; standing: IntakeStanding }> {
  const row = await getRequest(env, id).catch(() => null);
  const none = () => new HttpError(404, 'not_found', 'Request not found.');
  if (!row) throw none();
  if (!isTester(actor.email) && isTester(row.submitter_email)) throw none();
  const intake = await intakeRow(env, id);
  const standing = await standingFor(env, actor, row, intake);
  if (!standing.submitter && !standing.triage) throw none();
  return { row, intake, standing };
}

/** My requests: everything still open, and what finished or was declined in the last 45 days (all of it with all = true). */
export async function myItems(env: Env, actor: Actor, all = false): Promise<IntakeItem[]> {
  if (!actor.email.includes('@')) return [];
  const since = new Date(Date.now() - 45 * 86400000).toISOString();
  const r = await env.DB.prepare(
    `SELECT id FROM requests WHERE lower(submitter_email) = ? AND (? = 1 OR status NOT IN ('done', 'declined') OR COALESCE(completed_at, updated_at) > ?) ORDER BY created_at DESC LIMIT 200`
  )
    .bind(actor.email, all ? 1 : 0, since)
    .all<{ id: string }>();
  return buildItems(env, (r.results || []).map((x) => x.id));
}

export type QueueScope = 'intake' | 'open' | 'all';

/** The cards waiting on this person's teams. intake is Sent and still in Intake; open adds Approved and In progress; all adds Done and Declined. */
export async function queueItems(env: Env, actor: Actor, o: { team?: string; scope?: QueueScope } = {}): Promise<{ items: IntakeItem[]; teams: PipelineTeam[] }> {
  let teams = await triageTeams(env, actor);
  if (o.team) teams = teams.filter((t) => t === o.team);
  if (!teams.length) return { items: [], teams };
  const scope = o.scope || 'intake';
  const status = scope === 'intake' ? `q.status = 'inbox'` : scope === 'open' ? `q.status IN ('inbox', 'approved', 'in_progress')` : `1 = 1`;
  const test = isTester(actor.email) ? '' : ` AND lower(COALESCE(q.submitter_email, '')) NOT IN (${TEST_LIST})`;
  const r = await env.DB.prepare(
    `SELECT q.id FROM requests q JOIN hub_intake i ON i.request_id = q.id WHERE i.team IN (${placeholders(teams.length)}) AND ${status}${test} ORDER BY q.created_at ASC LIMIT 300`
  )
    .bind(...teams)
    .all<{ id: string }>();
  return { items: await buildItems(env, (r.results || []).map((x) => x.id)), teams };
}

export async function oneItem(env: Env, actor: Actor, id: string): Promise<{ item: IntakeItem; standing: IntakeStanding }> {
  const { standing } = await readableRequest(env, actor, id);
  const [item] = await buildItems(env, [id]);
  return { item, standing };
}

export type TeamOut = IntakeTeam;

/**
 * What waits on this person in one team's pipeline. Intake is every request still Sent (any owner of the team may accept it). Triage is
 * a request the owner accepted that sits in the pipeline's Triage stage and is this person's to start (their card, or a card nobody has
 * yet). The rail badge, the Intake tab and the phone bar all add these two numbers.
 */
async function waitingIn(env: Env, actor: Actor, team: PipelineTeam, projectId: string): Promise<{ intake: number; triage: number; questions: number; open: number }> {
  // A test account counts what is on its own board, the test pipeline: test requests only. Everyone else counts real requests only.
  const test = isTester(actor.email) ? ` AND lower(COALESCE(q.submitter_email, '')) IN (${TEST_LIST})` : ` AND lower(COALESCE(q.submitter_email, '')) NOT IN (${TEST_LIST})`;
  const c = await env.DB.prepare(
    `SELECT SUM(CASE WHEN q.status = 'inbox' THEN 1 ELSE 0 END) AS intake,
            SUM(CASE WHEN q.status = 'inbox' AND i.question_open = 1 THEN 1 ELSE 0 END) AS questions,
            SUM(CASE WHEN q.status IN ('inbox', 'approved', 'in_progress') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN q.status = 'approved' AND EXISTS (
                  SELECT 1 FROM hub_tasks t JOIN hub_project_sections s ON s.id = t.section_id
                   WHERE t.request_id = q.id AND t.project_id = ?2 AND t.status <> 'dropped' AND lower(trim(s.name)) = 'triage'
                     AND (COALESCE(t.owner_email, '') = '' OR lower(t.owner_email) = ?3)) THEN 1 ELSE 0 END) AS triage
       FROM hub_intake i JOIN requests q ON q.id = i.request_id WHERE i.team = ?1${test}`
  )
    .bind(team, projectId, actor.email)
    .first<{ intake: number | null; questions: number | null; open: number | null; triage: number | null }>();
  return { intake: Number(c?.intake) || 0, triage: Number(c?.triage) || 0, questions: Number(c?.questions) || 0, open: Number(c?.open) || 0 };
}

/** The teams this person triages, with their pipeline sections and how many requests wait. */
export async function teamsOut(env: Env, actor: Actor): Promise<TeamOut[]> {
  const out: TeamOut[] = [];
  for (const team of await triageTeams(env, actor)) {
    const pipe = (await pipelineFor(env, actor, team))!;
    const c = await waitingIn(env, actor, team, pipe.project.id);
    out.push({
      team,
      name: teamLabel(team),
      project: { id: pipe.project.id, key: pipe.project.key, name: pipe.project.name },
      sections: [...pipe.sections.values()].map((s) => ({ id: s.id, name: s.name, stage: stageOf(s.name) })),
      counts: { intake: c.intake, triage: c.triage, waiting: c.intake + c.triage, questions: c.questions, open: c.open },
    });
  }
  return out;
}

/**
 * The number on the Projects rail item, the Projects tab row and the phone bar for requests: Intake plus Triage waiting on this person,
 * over every team they triage. 0 for anyone who triages no team, and 0 before the intake tables are applied.
 */
export async function intakeWaitingCount(env: Env, actor: Actor): Promise<number> {
  try {
    let n = 0;
    for (const team of await triageTeams(env, actor)) {
      const pipe = await pipelineFor(env, actor, team);
      if (pipe) n += (await waitingIn(env, actor, team, pipe.project.id).then((c) => c.intake + c.triage));
    }
    return n;
  } catch {
    return 0;
  }
}

export type AcceptTarget = IntakeAcceptTarget;

/** The projects this person may accept a request into, each with its stages. The team's own pipeline comes first. */
export async function acceptTargets(env: Env, actor: Actor): Promise<AcceptTarget[]> {
  const pipes = await pipelineIds(env);
  const list = (await listProjects(env, actor)).filter((p) => p.status !== 'archived' && p.status !== 'done');
  const allowed: ProjectRow[] = [];
  for (const p of list) if ((await projectStanding(env, actor, p as unknown as ProjectRow)).edit) allowed.push(p as unknown as ProjectRow);
  const out: AcceptTarget[] = [];
  for (const p of allowed) {
    out.push({
      id: p.id,
      key: p.key,
      name: p.name,
      synced: !!(await syncedProject(env, p.id).catch(() => null)),
      pipeline: pipes.get(p.id) || null,
      sections: (await sectionsOf(env, p.id)).map((s) => ({ id: s.id, name: s.name })),
    });
  }
  return out.sort((a, b) => (a.pipeline ? 0 : 1) - (b.pipeline ? 0 : 1) || a.name.localeCompare(b.name));
}
