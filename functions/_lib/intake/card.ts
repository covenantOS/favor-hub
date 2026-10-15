// A request's card: the hub_tasks row (request_id set) that sits in the Intake section of its team's pipeline, and the hub_intake row
// that keeps what the composer sent. Made when a request is sent, when an old request is brought over, and on the spot when someone
// triages a request that has no card yet.
import { newId, nowIso, type Env } from '../http';
import type { RequestRow } from '../db';
import { addEvent, lower, FAVOR, type TaskRow } from '../projects/db';
import { ORIGIN } from '../integrations/accept';
import { isTester } from '../testuser';
import type { PipelineTeam, Stage } from '../../../shared/intake-model';
import { ensurePipeline } from './pipeline';

export interface IntakeRow {
  request_id: string;
  task_id: string | null;
  team: PipelineTeam;
  kind: string;
  place: string;
  audience: string;
  needed: string;
  assignee_hint: string | null;
  chips: string;
  question_open: number;
  question_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  migrated: number;
  created_at: string;
}

export const intakeRow = (env: Env, requestId: string) => env.DB.prepare('SELECT * FROM hub_intake WHERE request_id = ?').bind(requestId).first<IntakeRow>().catch(() => null);

/** The card text: where the request came from and what it says. The link opens the request in Projects. */
export function cardDescription(row: Pick<RequestRow, 'id' | 'body' | 'submitter_name' | 'submitter_email'>): string {
  const asked = row.submitter_name || row.submitter_email || 'someone';
  return `Request from ${asked}: ${ORIGIN}/projects/?r=${encodeURIComponent(row.id)}\n\n${String(row.body || '').slice(0, 15000)}`.slice(0, 20000);
}

/** The card for a request, if it has one that is not dropped. */
export async function cardOf(env: Env, requestId: string): Promise<TaskRow | null> {
  return env.DB.prepare(`SELECT * FROM hub_tasks WHERE request_id = ? AND status <> 'dropped' ORDER BY created_at LIMIT 1`).bind(requestId).first<TaskRow>().catch(() => null);
}

export interface NewCard {
  row: RequestRow;
  team: PipelineTeam;
  stage?: Stage;
  /** done puts the card in Done already ticked, for a request that was finished before it was brought over. */
  done?: boolean;
  owner?: string | null;
  due?: string | null;
  createdAt?: string;
}

/** Makes the card in the team's pipeline. Safe to call twice: the second call returns the card the first one made. */
export async function createCard(env: Env, o: NewCard): Promise<TaskRow> {
  const have = await cardOf(env, o.row.id);
  if (have) return have;
  // A test account's request goes to the test pipeline, which only the test accounts can open.
  const pipe = await ensurePipeline(env, o.team, isTester(o.row.submitter_email) ? lower(o.row.submitter_email) : undefined);
  const stage: Stage = o.stage || (o.done ? 'Done' : 'Intake');
  const section = pipe.sections.get(stage)!;
  const n = await env.DB.prepare('UPDATE hub_projects SET next_num = next_num + 1 WHERE id = ? RETURNING next_num').bind(pipe.project.id).first<{ next_num: number }>();
  const code = `${pipe.project.key}-${String((Number(n?.next_num) || 2) - 1).padStart(4, '0')}`;
  const mx = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM hub_tasks WHERE project_id = ? AND section_id = ? AND parent_id IS NULL').bind(pipe.project.id, section.id).first<{ m: number }>();
  const id = newId('tsk');
  const now = o.createdAt || nowIso();
  const status = o.done ? 'done' : 'open';
  // The pipeline's lead is the creator on the card, never the person who asked: a creator can always open a task, and the person who
  // asked reads their request through My requests, not through the team's board.
  const by = lower(pipe.project.lead_email);
  await env.DB.prepare(
    `INSERT INTO hub_tasks (id, project_id, section_id, code, title, description, status, priority, owner_email, due_date, done_at, done_by, sort, request_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, pipe.project.id, section.id, code, o.row.title.slice(0, 300), cardDescription(o.row), status, o.owner && FAVOR.test(lower(o.owner)) ? lower(o.owner) : null, o.due || null, o.done ? o.row.completed_at || now : null, o.done ? by : null, (Number(mx?.m) || 0) + 1024, o.row.id, by, now, now)
    .run();
  await addEvent(env, { task_id: id, project_id: pipe.project.id, actor: by, kind: 'created', detail: { title: o.row.title, via: 'request' } });
  const made = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ?').bind(id).first<TaskRow>();
  return made!;
}
