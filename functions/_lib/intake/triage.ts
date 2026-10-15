// What the owner of a team's pipeline does with a request in Intake: accept it into a project and stage, ask a question, or decline it
// with a reason. The person who asked can answer a question. Every action is one call, safe to repeat, and each tells the person who
// asked the way the board always has (a Chat card or one email, behind the request notice gate), never a test account.
import { HttpError, nowIso, type Env } from '../http';
import { addEvent as addRequestEvent, getRequest, setStatus, type RequestRow } from '../db';
import { cleanBody } from '../chat/text';
import { staffDirectory } from '../people';
import { TESTER_REFUSAL, isTester } from '../testuser';
import { projectStanding } from '../projects/access';
import { patchTask } from '../projects/tasks';
import { fire } from '../projects/hooks';
import { lower, projectOf, sectionsOf, FAVOR, type ProjectRow, type TaskRow } from '../projects/db';
import { addComment, addFollower, upsertTask, type Actor, type TaskEnv } from '../requests/tasks';
import { DEFAULT_ACCEPT_STAGE, INTAKE_LIMITS, type IntakeItem, type IntakeTriageInput, type PipelineTeam } from '../../../shared/intake-model';
import { cardOf, createCard, intakeRow, type IntakeRow } from './card';
import { ensurePipeline, pipelineIds } from './pipeline';
import { buildItems } from './items';
import { alignRequest } from './stage';
import { legacyTeam, readableRequest } from './views';

type Fire = (kind: string, task: TaskRow | null, project: ProjectRow | null, detail?: Record<string, unknown>) => Promise<void>;

const fireFor = (env: TaskEnv, actor: Actor): Fire => (kind, task, project, detail = {}) =>
  fire(env, { kind, actor: actor.email, actorName: actor.name, task, project, detail: { ...detail, from: 'intake' } }, env.DEFER);

/** The request, its card and its team for a triage action. A request with no card yet (an old one) gets its card first. */
async function forTriage(env: TaskEnv, actor: Actor, id: string): Promise<{ row: RequestRow; intake: IntakeRow; team: PipelineTeam; card: TaskRow }> {
  const { row, intake, standing } = await readableRequest(env, actor, id);
  if (!standing.triage) throw new HttpError(403, 'forbidden', 'Only the owners of this team\'s requests and FavorOS admins can do that.');
  if (row.status === 'done' || row.status === 'declined') throw new HttpError(400, 'closed', 'This request is already closed.');
  const team = intake?.team || legacyTeam(row);
  const card = (await cardOf(env, id)) || (await createCard(env, { row, team }));
  let have = intake;
  if (!have) {
    await env.DB.prepare(`INSERT OR IGNORE INTO hub_intake (request_id, task_id, team, kind, place, audience, needed, created_at) VALUES (?, ?, ?, 'other', ?, '', '', ?)`)
      .bind(id, card.id, team, team === 'marketing' ? 'design' : row.surface, row.created_at)
      .run();
    have = (await intakeRow(env, id))!;
  }
  return { row, intake: have, team, card };
}

const itemOf = async (env: Env, id: string): Promise<IntakeItem> => (await buildItems(env, [id]))[0];

/**
 * Accept: the card moves into the project and stage picked (the team's own Triage when none is), takes an owner and a due date, the
 * request becomes Approved (or further, from the stage's name), and the person who asked is told once. Pressing it again moves the
 * card again and tells nobody twice. A project linked to Asana takes the card in one of the stages it already has, and the card goes
 * to Asana the usual way.
 */
export async function acceptCard(env: TaskEnv, actor: Actor, id: string, b: IntakeTriageInput): Promise<{ request: IntakeItem; told: { via: string; why: string } }> {
  const { row, intake, team, card } = await forTriage(env, actor, id);
  const dir = new Map((await staffDirectory(env).catch(() => [])).map((p) => [lower(p.email), p]));
  const ownerEmail = lower(b.owner_email || card.owner_email || intake.assignee_hint || (FAVOR.test(actor.email) ? actor.email : ''));
  if (!FAVOR.test(ownerEmail) || !(dir.has(ownerEmail) || isTester(ownerEmail))) throw new HttpError(400, 'unknown_person', 'Pick the owner from the staff list.');
  if (isTester(actor.email) && !isTester(ownerEmail)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
  let due: string | null | undefined;
  if (b.due_date !== undefined) {
    due = b.due_date === null || b.due_date === '' ? null : String(b.due_date);
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due + 'T12:00:00Z')))) throw new HttpError(400, 'bad_date', 'Pick a date.');
  }

  // The pipeline the card is in (a test card is in the test pipeline), else the team's own.
  const pipes = await pipelineIds(env);
  const here = card.project_id && pipes.has(card.project_id) ? await projectOf(env, card.project_id) : (await ensurePipeline(env, team)).project;
  const target = b.project_id ? await projectOf(env, String(b.project_id)) : here;
  if (!(await projectStanding(env, actor, target)).edit) throw new HttpError(403, 'forbidden', 'Only people on that project can take a request into it.');
  const toPipeline = pipes.has(target.id);
  // The stage: the one picked, else Triage in a pipeline. A card already past Intake in the same project stays where it is.
  let sectionId: string | undefined = b.section_id ? String(b.section_id) : undefined;
  if (!sectionId && toPipeline) {
    const sects = await sectionsOf(env, target.id);
    const cur = sects.find((s) => s.id === card.section_id);
    const stay = cur && card.project_id === target.id && !/^intake$/i.test(cur.name);
    if (!stay) sectionId = sects.find((s) => s.name.trim().toLowerCase() === DEFAULT_ACCEPT_STAGE.toLowerCase())?.id;
  }

  const patch: Record<string, unknown> = { owner_email: ownerEmail };
  if (due !== undefined) patch.due_date = due;
  if (target.id !== card.project_id) patch.project_id = target.id;
  if (sectionId && (sectionId !== card.section_id || target.id !== card.project_id)) patch.move = { section_id: sectionId };
  const patched = await patchTask(env, actor, card.id, patch);
  const fired = fireFor(env, actor);
  if (patched.changed.length) {
    await fired(patched.kinds.includes('moved') || patched.kinds.includes('project') ? 'task.moved' : 'task.updated', patched.task, patched.project, { fields: patched.changed, before: patched.before });
    if (patched.changed.includes('owner_email')) await fired('task.assigned', patched.task, patched.project, { from: patched.before.owner_email, to: patched.task.owner_email });
  }

  // The old board's record keeps the owner and date for its notices, and the owner follows the request.
  const prev = await env.DB.prepare('SELECT owner_email FROM request_tasks WHERE request_id = ?').bind(id).first<{ owner_email: string | null }>().catch(() => null);
  await upsertTask(env, id, { owner_email: ownerEmail, ...(prev?.owner_email !== ownerEmail ? { sent_by: actor.email, sent_at: nowIso() } : {}), ...(due !== undefined ? { due_date: due } : {}) });
  await addFollower(env, id, ownerEmail, 'owner');
  if (FAVOR.test(actor.email)) await addFollower(env, id, actor.email, 'comment');

  await alignRequest(env, card.id, actor, { minimum: 'approved', note: b.note ? String(b.note).slice(0, INTAKE_LIMITS.note) : '' });
  const sec = patched.task.section_id ? (await sectionsOf(env, patched.task.project_id || '')).find((s) => s.id === patched.task.section_id) : null;
  await addRequestEvent(env, id, 'triage', actor.name, { action: 'accept', project: patched.project?.name || target.name, stage: sec?.name || null, owner: ownerEmail }).catch(() => undefined);
  await env.DB.prepare('UPDATE hub_intake SET question_open = 0, task_id = ?, decided_by = ?, decided_at = ? WHERE request_id = ?').bind(card.id, actor.email, nowIso(), id).run();
  const ev = await env.DB.prepare(`SELECT payload FROM events WHERE request_id = ? AND kind = 'accepted' ORDER BY created_at DESC LIMIT 1`).bind(id).first<{ payload: string | null }>().catch(() => null);
  let via = 'none';
  try {
    via = JSON.parse(ev?.payload || '{}').told || 'none';
  } catch {
    via = 'none';
  }
  return { request: await itemOf(env, id), told: { via, why: via === 'none' ? 'Nobody was told: they were told before, notices are off, or the person is the owner.' : '' } };
}

/**
 * Ask a question: a comment on the request from the owner, which the person who asked is told about the way any comment is. The card
 * stays in Intake with the question open until they answer.
 */
export async function askQuestion(env: TaskEnv, actor: Actor, id: string, questionRaw: unknown): Promise<IntakeItem> {
  const { row } = await forTriage(env, actor, id);
  const body = cleanBody(questionRaw).slice(0, INTAKE_LIMITS.question);
  if (!body) throw new HttpError(400, 'empty', 'Write your question first.');
  if (FAVOR.test(actor.email)) await addFollower(env, id, actor.email, 'comment');
  await addComment(env, row, actor, body, { source: 'board' });
  const now = nowIso();
  await addRequestEvent(env, id, 'asked', actor.name, { body, by_email: actor.email }).catch(() => undefined);
  await env.DB.prepare('UPDATE hub_intake SET question_open = 1, question_at = ? WHERE request_id = ?').bind(now, id).run();
  return itemOf(env, id);
}

/** The person who asked answers (or the owner adds a note). Their answer closes the open question. */
export async function replyToRequest(env: TaskEnv, actor: Actor, id: string, bodyRaw: unknown): Promise<IntakeItem> {
  const { row, standing } = await readableRequest(env, actor, id);
  const body = cleanBody(bodyRaw).slice(0, INTAKE_LIMITS.question);
  if (!body) throw new HttpError(400, 'empty', 'Write your answer first.');
  if (FAVOR.test(actor.email)) await addFollower(env, id, actor.email, 'comment');
  await addComment(env, row, actor, body, { source: 'board' });
  if (standing.submitter) {
    await env.DB.prepare('UPDATE hub_intake SET question_open = 0 WHERE request_id = ?').bind(id).run();
    await addRequestEvent(env, id, 'answered', actor.name, {}).catch(() => undefined);
  }
  return itemOf(env, id);
}

/**
 * Decline: the request closes with the reason, the card is dropped from the team's board, and the person who asked reads the reason on
 * My requests and is told by a comment from the owner. A closed request cannot be declined.
 */
export async function declineCard(env: TaskEnv, actor: Actor, id: string, reasonRaw: unknown): Promise<IntakeItem> {
  const { row, card } = await forTriage(env, actor, id);
  const reason = cleanBody(reasonRaw).slice(0, INTAKE_LIMITS.reason);
  if (reason.length < 2) throw new HttpError(400, 'reason', 'Say why, in a sentence, so the person who asked knows.');
  const patched = await patchTask(env, actor, card.id, { status: 'dropped' });
  if (patched.changed.length) await fireFor(env, actor)('task.updated', patched.task, patched.project, { fields: patched.changed, before: patched.before });
  await setStatus(env, id, 'declined', actor.name, { declined_reason: reason });
  if (FAVOR.test(actor.email)) await addFollower(env, id, actor.email, 'comment');
  await addComment(env, row, actor, `Declined: ${reason}`, { source: 'board' }).catch((err) => console.error('[intake] decline comment', err));
  await addRequestEvent(env, id, 'triage', actor.name, { action: 'decline', reason }).catch(() => undefined);
  await env.DB.prepare('UPDATE hub_intake SET question_open = 0, decided_by = ?, decided_at = ? WHERE request_id = ?').bind(actor.email, nowIso(), id).run();
  return itemOf(env, id);
}
