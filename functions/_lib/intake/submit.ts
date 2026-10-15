// Sending a request from the composer. The words are read by the shared parser (shared/request-parse.ts, the same code the composer
// runs), the person's edited chips win over it, and the request lands as a card in Intake at the start of the owning team's pipeline.
// A request about money goes to the expense form instead and makes no card.
import { HttpError, type Env } from '../http';
import { ALLOWED_TYPES, MAX_FILES, MAX_FILE_BYTES, insertRequest, saveAttachment, type AttachmentRow, type RequestRow } from '../db';
import { typeFrom } from '../create';
import { notifyNewRequest } from '../notify';
import { isTester } from '../testuser';
import { staffDirectory } from '../people';
import { suggestOwner } from '../requests/suggest';
import { addFollower, tellPeople, upsertTask, type Actor, type TaskEnv } from '../requests/tasks';
import { fire } from '../projects/hooks';
import { lower, taskById, FAVOR } from '../projects/db';
import {
  AUDIENCE_OPTIONS,
  KIND_OPTIONS,
  PLACE_OPTIONS,
  easternDay,
  parseRequest,
  type Parsed,
  type PersonLite,
} from '../../../shared/request-parse';
import { INTAKE_LIMITS, type IntakeSubmit, type PipelineTeam } from '../../../shared/intake-model';
import { createCard } from './card';
import { ensurePipeline } from './pipeline';

/** What the composer shows while the person types: the chips, with a suggested owner from the board's history. */
export async function parseFor(env: Env, text: string): Promise<{ parsed: Parsed; people: PersonLite[] }> {
  const people = (await staffDirectory(env).catch(() => [])).map((p) => ({ email: p.email, name: p.name, team: p.team, title: p.title }));
  const today = easternDay();
  const first = parseRequest(text, today, { people });
  // The owner guess depends on the place the words name, so it is asked once the first reading has it.
  const route = first.team.value === 'marketing' ? 'marketing' : first.team.value === 'expense' ? 'expense' : 'board';
  const surface = (['website', 'portal', 'dashboard', 'app'] as const).find((s) => s === first.place.value) || 'website';
  const guess = first.team.value === 'expense' ? null : await suggestOwner(env, surface, today, route).catch(() => null);
  return { parsed: guess ? parseRequest(text, today, { people, ownerGuess: guess }) : first, people };
}

const pick = (v: unknown, allowed: string[]): string | null => (typeof v === 'string' && allowed.includes(v.trim()) ? v.trim() : null);

export interface Submitted {
  expense?: { href: string };
  request?: RequestRow;
  task?: { id: string; code: string | null };
  team?: PipelineTeam;
  attachments: AttachmentRow[];
  parsed: Parsed;
}

export interface FileIn {
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
}

/** Sends a request. Throws 400 for words that are too short or a chip that is not allowed. */
export async function submitRequest(env: TaskEnv, actor: Actor, input: IntakeSubmit & { title?: string }, files: FileIn[] = []): Promise<Submitted> {
  if (!FAVOR.test(actor.email)) throw new HttpError(403, 'forbidden', 'Sign in with your Favor account to send a request.');
  const text = String(input.text || '').replace(/\r\n/g, '\n').trim().slice(0, 16000);
  if (text.length < 2) throw new HttpError(400, 'too_short', 'Say a little about what you need.');
  if (text.length > INTAKE_LIMITS.text * 4) throw new HttpError(400, 'too_long', 'That is too long. Keep it to a few paragraphs and attach the rest.');
  if (files.length > MAX_FILES) throw new HttpError(400, 'too_many_files', `Up to ${MAX_FILES} files.`);
  for (const f of files) {
    if (f.bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(400, 'file_too_large', 'Each file must be under 4 MB.');
    if (!ALLOWED_TYPES.includes(f.contentType) && !/\.(jpe?g|png|webp|gif|pdf|docx?|txt)$/i.test(f.filename)) throw new HttpError(400, 'bad_file', 'Pictures, PDF, Word, or text only.');
  }

  const { parsed, people } = await parseFor(env, text);
  const team = (pick(input.team, ['tech', 'marketing', 'expense']) || parsed.team.value) as 'tech' | 'marketing' | 'expense';
  if (team === 'expense') return { expense: { href: `/expenses/new/?reason=${encodeURIComponent(text.slice(0, 300))}` }, attachments: [], parsed };

  const kind = pick(input.kind, KIND_OPTIONS.map((o) => o.value)) || parsed.kind.value;
  const placeOptions = PLACE_OPTIONS[team].map((o) => o.value as string);
  const place = pick(input.place, placeOptions) || (placeOptions.includes(parsed.place.value) ? parsed.place.value : placeOptions[0]);
  const audience = pick(input.audience, AUDIENCE_OPTIONS[team]) || (AUDIENCE_OPTIONS[team].includes(parsed.audience.value) ? parsed.audience.value : 'Not sure who sees it');
  let due: string | null = parsed.due.value || null;
  if (input.due_date !== undefined) {
    const d = input.due_date === null || input.due_date === '' ? null : String(input.due_date);
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T12:00:00Z')))) throw new HttpError(400, 'bad_date', 'Pick a date.');
    due = d;
  }
  let hint: string | null = parsed.assignee && !parsed.assignee.guess ? parsed.assignee.value : null;
  if (input.assignee !== undefined) {
    const a = input.assignee ? lower(input.assignee) : '';
    if (a && !people.some((p) => lower(p.email) === a)) throw new HttpError(400, 'unknown_person', 'Pick the person from the staff list.');
    hint = a || null;
  }
  const title = String(input.title || '').trim().slice(0, 160) || parsed.title;

  const pipe = await ensurePipeline(env, team, isTester(actor.email) ? actor.email : undefined);
  const row = await insertRequest(env, {
    title,
    body: text,
    surface: (team === 'tech' ? place : 'marketing') as never,
    submitter_name: actor.name,
    submitter_email: actor.email,
    page_url: parsed.page_url,
    source: 'projects',
  });
  const saved: AttachmentRow[] = [];
  for (const f of files) saved.push(await saveAttachment(env, row.id, { ...f, contentType: typeFrom(f) }));

  const card = await createCard(env, { row, team, due });
  const chips = {
    team: { value: team, why: parsed.team.why },
    kind: { value: kind, why: parsed.kind.why },
    place: { value: place, why: parsed.place.why },
    audience: { value: audience, why: parsed.audience.why },
    due: { value: due, why: parsed.due.why },
    assignee: { value: hint, why: parsed.assignee?.why || '' },
  };
  await env.DB.prepare(
    `INSERT INTO hub_intake (request_id, task_id, team, kind, place, audience, needed, assignee_hint, chips, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(row.id, card.id, team, kind, place, audience, parsed.needed, hint, JSON.stringify(chips), row.created_at)
    .run();
  // The old board's own task record carries the date and the owner for its notices; the person who asked is part of the request.
  await upsertTask(env, row.id, { due_date: due });
  await addFollower(env, row.id, actor.email, 'comment');

  // Tell the team's lead. A test account tells nobody, and the lead hears only if request notices are on (the gate).
  const lead = lower(pipe.project.lead_email);
  if (!isTester(actor.email) && lead && lead !== actor.email) await tellPeople(env, row.id, actor, [{ email: lead, kind: 'sent', note: title }]).catch((err) => console.error('[intake] tell', err));
  // The board's new-request email to Tech, as it always was. Marketing hears through its notices.
  if (!isTester(actor.email) && team === 'tech') {
    const mail = notifyNewRequest(env, row).catch((err) => console.error('[intake] notify', err));
    if (env.DEFER) env.DEFER(mail);
    else await mail;
  }
  await fire(env, { kind: 'task.created', actor: actor.email, actorName: actor.name, task: await taskById(env, card.id), project: pipe.project, detail: { from: 'intake' } }, env.DEFER);
  return { request: row, task: { id: card.id, code: card.code }, team, attachments: saved, parsed };
}
