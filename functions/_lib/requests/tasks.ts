// Tasks on the request board: an owner, hand-offs with a note, comments with @mentions, followers, a due date and "Waiting on".
// Who may do what:
//   a hub admin      everything, on every request (the board's triage stays admin only)
//   the owner        send it on, comment, set the due date and Waiting on, mark it done or reopen it
//   a participant    (sent it, was mentioned, is waited on, commented) comment, mark it done or reopen it
//   anyone else      reads the board as before; Follow only subscribes them, it gives no rights
// Every notice (Today, the bell, a Chat card) goes through noticeGate: off until an admin sets requests.notify to on.
import { HttpError, newId, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { effective } from '../admin/settings';
import { addEvent, getRequest, setStatus, type RequestRow } from '../db';
import { staffDirectory, type Person } from '../people';
import { cleanBody, parseMentions } from '../chat/text';
import { copyComment, postCard, type CardKind } from '../chat/tasks';
import { mailNotices } from './mail';
import { plainMentions, toldFor, type Told } from './views';

export interface Actor {
  email: string;
  name: string;
  admin: boolean;
  /** Sees every staff-visible project and task: admins, Early access and Marketing. Others see only what they are on. */
  wide?: boolean;
}

export interface TaskRow {
  request_id: string;
  owner_email: string | null;
  sent_by: string | null;
  sent_at: string | null;
  due_date: string | null;
  waiting_on: string | null;
  updated_at: string;
}

export interface Follower {
  email: string;
  why: string;
  muted: number;
}

export interface CommentRow {
  id: string;
  request_id: string;
  email: string;
  name: string;
  body: string;
  source: string;
  chat_message_id: number | null;
  created_at: string;
  deleted_at: string | null;
}

/** DEFER, when a route sets it, runs slow follow-up work (email) after the answer has gone out. */
export type TaskEnv = Env & { DEFER?: (p: Promise<unknown>) => void; /** The morning pass hands its clock down so "due tomorrow" is worded from the same moment. */ CLOCK?: Date };

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
// Reasons that make someone part of the request. A plain Follow does not.
const PART_OF = new Set(['owner', 'sent', 'mention', 'waiting', 'comment']);

/**
 * The person acting. The agent key may act as a staff member for a role test (X-Act-As), the way the Work Center allows it;
 * that person is never an admin here.
 */
export function actorOf(request: Request, user: HubUser | null): Actor | null {
  if (!user) return null;
  if (user.via === 'agent') {
    const as = lower(request.headers.get('X-Act-As'));
    if (as && FAVOR.test(as)) return { email: as, name: as, admin: false };
    return { email: 'agent', name: 'Agent', admin: true };
  }
  return { email: lower(user.email), name: user.name || user.email, admin: user.role === 'admin' };
}

/* ------------------------------------------------------------------------------------------------ reads */

/** False until db/request-tasks.sql is applied; every route then answers as the board did before. */
export async function tasksReady(env: TaskEnv): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT request_id FROM request_tasks LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export async function taskOf(env: TaskEnv, id: string): Promise<TaskRow | null> {
  return env.DB.prepare('SELECT request_id, owner_email, sent_by, sent_at, due_date, waiting_on, updated_at FROM request_tasks WHERE request_id = ?')
    .bind(id)
    .first<TaskRow>()
    .catch(() => null);
}

export async function followersOf(env: TaskEnv, id: string): Promise<Follower[]> {
  const r = await env.DB.prepare('SELECT email, why, muted FROM request_followers WHERE request_id = ? ORDER BY created_at, email')
    .bind(id)
    .all<Follower>()
    .catch(() => ({ results: [] as Follower[] }));
  return r.results || [];
}

export async function commentsOf(env: TaskEnv, id: string): Promise<CommentRow[]> {
  const r = await env.DB.prepare(
    'SELECT id, request_id, email, name, body, source, chat_message_id, created_at, deleted_at FROM request_comments WHERE request_id = ? ORDER BY created_at, id'
  )
    .bind(id)
    .all<CommentRow>()
    .catch(() => ({ results: [] as CommentRow[] }));
  return r.results || [];
}

export interface Standing {
  admin: boolean;
  owner: boolean;
  /** Part of the request: owner, sent it, mentioned, waited on or commented. */
  part: boolean;
  following: boolean;
}

export function standingOf(actor: Actor, task: TaskRow | null, followers: Follower[]): Standing {
  const me = actor.email;
  const f = followers.find((x) => x.email === me);
  const owner = !!task && task.owner_email === me;
  const part = owner || (!!task && task.sent_by === me) || (!!task && task.waiting_on === me) || (!!f && PART_OF.has(f.why));
  return { admin: actor.admin, owner, part, following: !!f && !f.muted };
}

function need(ok: boolean, message = 'Only the person it was sent to, people named on it, or a FavorOS admin can do that.'): void {
  if (!ok) throw new HttpError(403, 'forbidden', message);
}

/* ------------------------------------------------------------------------------------------------ notices */

/** Who may be told. Off (the default) tells nobody except the addresses listed in requests.notify.only, for testing. */
export async function noticeGate(env: TaskEnv): Promise<(email: string) => boolean> {
  const mode = lower(await effective(env, 'requests.notify', undefined, 'off').catch(() => 'off'));
  if (mode === 'on') return () => true;
  const only = new Set(
    String(await effective(env, 'requests.notify.only', undefined, '').catch(() => ''))
      .split(/[\s,;]+/)
      .map(lower)
      .filter(Boolean)
  );
  return (email: string) => only.has(lower(email));
}

export interface Notice {
  email: string;
  kind: 'sent' | 'mention' | 'comment' | 'waiting' | 'done' | 'due' | 'accepted';
  note: string;
  comment_id?: string | null;
}

/** Saves the notices the gate allows, never one to the person who acted. Returns who was told. */
export async function tellPeople(env: TaskEnv, requestId: string, actor: Actor, list: Notice[]): Promise<string[]> {
  if (!list.length) return [];
  const gate = await noticeGate(env);
  const now = nowIso();
  const seen = new Set<string>();
  const keep = list.filter((n) => {
    const e = lower(n.email);
    if (!e || e === actor.email || seen.has(e) || !gate(e)) return false;
    seen.add(e);
    return true;
  });
  if (!keep.length) return [];
  const made: Array<{ id: number; email: string; kind: Notice['kind']; note: string }> = [];
  for (const n of keep) {
    const r = await env.DB.prepare(
      'INSERT INTO request_notices (request_id, email, kind, actor_email, actor_name, note, comment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(requestId, lower(n.email), n.kind, actor.email, actor.name, n.note.slice(0, 600), n.comment_id || null, now)
      .run();
    made.push({ id: Number((r.meta as { last_row_id?: number }).last_row_id), email: lower(n.email), kind: n.kind, note: n.note });
  }
  // Email follows the notice: one per event for people who chose that, nothing for the daily summary people until morning.
  const mail = mailNotices(env, requestId, actor, made).catch((err) => console.error('[tasks] mail', err));
  if (env.DEFER) env.DEFER(mail);
  else await mail;
  return keep.map((n) => lower(n.email));
}

/** True when this person may be told about requests right now (the gate). Today and the Work Overview ask before showing anything. */
export async function mayHear(env: TaskEnv, email: string): Promise<boolean> {
  return (await noticeGate(env))(email);
}

export interface NoticeOut {
  id: number;
  request_id: string;
  title: string;
  status: string;
  kind: string;
  actor_email: string;
  actor_name: string;
  note: string;
  created_at: string;
}

export async function noticesFor(env: TaskEnv, email: string, limit = 20): Promise<{ count: number; requests: number; items: NoticeOut[] }> {
  const me = lower(email);
  try {
    const c = await env.DB.prepare(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT n.request_id) AS r FROM request_notices n JOIN requests q ON q.id = n.request_id WHERE n.email = ? AND n.read_at IS NULL'
    )
      .bind(me)
      .first<{ n: number; r: number }>();
    const rows = await env.DB.prepare(
      `SELECT n.id, n.request_id, q.title, q.status, n.kind, n.actor_email, n.actor_name, n.note, n.created_at
         FROM request_notices n JOIN requests q ON q.id = n.request_id
        WHERE n.email = ? AND n.read_at IS NULL ORDER BY n.id DESC LIMIT ?`
    )
      .bind(me, limit)
      .all<NoticeOut>();
    const items = rows.results || [];
    if (items.some((i) => i.note.includes('<@'))) {
      const dir = await directoryMap(env);
      for (const i of items) i.note = plainMentions(i.note, dir);
    }
    return { count: Number(c?.n) || 0, requests: Number(c?.r) || 0, items };
  } catch {
    return { count: 0, requests: 0, items: [] };
  }
}

/** Marks this person's notices read: one notice, every notice on one request, or all of them. */
export async function readNotices(env: TaskEnv, email: string, opts: { id?: number | null; request_id?: string | null } = {}): Promise<void> {
  const me = lower(email);
  const now = nowIso();
  if (opts.id) await env.DB.prepare('UPDATE request_notices SET read_at = ? WHERE email = ? AND id = ? AND read_at IS NULL').bind(now, me, opts.id).run();
  else if (opts.request_id) await env.DB.prepare('UPDATE request_notices SET read_at = ? WHERE email = ? AND request_id = ? AND read_at IS NULL').bind(now, me, opts.request_id).run();
  else await env.DB.prepare('UPDATE request_notices SET read_at = ? WHERE email = ? AND read_at IS NULL').bind(now, me).run();
}

/* ------------------------------------------------------------------------------------------------ writes */

export async function upsertTask(env: TaskEnv, id: string, fields: Partial<Omit<TaskRow, 'request_id' | 'updated_at'>>): Promise<TaskRow> {
  const prev = await taskOf(env, id);
  const next: TaskRow = {
    request_id: id,
    owner_email: prev?.owner_email ?? null,
    sent_by: prev?.sent_by ?? null,
    sent_at: prev?.sent_at ?? null,
    due_date: prev?.due_date ?? null,
    waiting_on: prev?.waiting_on ?? null,
    ...fields,
    updated_at: nowIso(),
  };
  await env.DB.prepare(
    `INSERT INTO request_tasks (request_id, owner_email, sent_by, sent_at, due_date, waiting_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(request_id) DO UPDATE SET owner_email = excluded.owner_email, sent_by = excluded.sent_by, sent_at = excluded.sent_at,
       due_date = excluded.due_date, waiting_on = excluded.waiting_on, updated_at = excluded.updated_at`
  )
    .bind(next.request_id, next.owner_email, next.sent_by, next.sent_at, next.due_date, next.waiting_on, next.updated_at)
    .run();
  await env.DB.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').bind(next.updated_at, id).run();
  return next;
}

/** Adds a follower. A stronger reason replaces a weaker one; someone who pressed Unfollow stays unfollowed unless they are the owner. */
export async function addFollower(env: TaskEnv, id: string, email: string, why: string): Promise<void> {
  const e = lower(email);
  if (!FAVOR.test(e)) return;
  const rank = (w: string) => ['follow', 'comment', 'mention', 'waiting', 'sent', 'owner'].indexOf(w);
  const prev = await env.DB.prepare('SELECT why, muted FROM request_followers WHERE request_id = ? AND email = ?').bind(id, e).first<{ why: string; muted: number }>();
  if (!prev) {
    await env.DB.prepare('INSERT INTO request_followers (request_id, email, why, muted, created_at) VALUES (?, ?, ?, 0, ?)').bind(id, e, why, nowIso()).run();
    return;
  }
  const better = rank(why) > rank(prev.why) ? why : prev.why;
  const muted = why === 'owner' ? 0 : prev.muted;
  if (better !== prev.why || muted !== prev.muted) {
    await env.DB.prepare('UPDATE request_followers SET why = ?, muted = ? WHERE request_id = ? AND email = ?').bind(better, muted, id, e).run();
  }
}

export async function setFollowing(env: TaskEnv, id: string, actor: Actor, on: boolean): Promise<void> {
  const prev = await env.DB.prepare('SELECT why FROM request_followers WHERE request_id = ? AND email = ?').bind(id, actor.email).first<{ why: string }>();
  if (!prev) {
    if (on) await addFollower(env, id, actor.email, 'follow');
    return;
  }
  await env.DB.prepare('UPDATE request_followers SET muted = ? WHERE request_id = ? AND email = ?').bind(on ? 0 : 1, id, actor.email).run();
}

/** Following people who have not muted it, minus the actor. */
async function audience(env: TaskEnv, id: string, actor: Actor): Promise<string[]> {
  return (await followersOf(env, id)).filter((f) => !f.muted && f.email !== actor.email).map((f) => f.email);
}

async function directoryMap(env: TaskEnv): Promise<Map<string, Person>> {
  return new Map((await staffDirectory(env)).map((p) => [p.email, p]));
}

function nameOf(dir: Map<string, Person>, email: string): string {
  return dir.get(lower(email))?.name || lower(email).split('@')[0];
}

/** Chat cards and copies go out only for people the gate allows; a failure there never undoes the board change. */
async function chatCard(env: TaskEnv, actor: Actor, to: string, requestId: string, kind: CardKind, note: string, allowed: string[]): Promise<void> {
  if (!allowed.includes(lower(to)) || !FAVOR.test(actor.email)) return;
  await postCard(env, { from: actor.email, to: lower(to), requestId, kind, note }).catch((err) => console.error('[tasks] card', err));
}

/**
 * Send the request to someone with a note: they become the owner, the note opens the conversation, and they hear about it on
 * Today, the bell and in Chat as a direct message from the sender. The history records who sent it to whom and why.
 */
export async function sendTo(env: TaskEnv, row: RequestRow, actor: Actor, toRaw: unknown, noteRaw: unknown): Promise<{ task: TaskRow; comment: CommentRow | null }> {
  const task = await taskOf(env, row.id);
  const st = standingOf(actor, task, await followersOf(env, row.id));
  need(st.admin || st.owner, 'Only the owner or a FavorOS admin can send this request on.');
  const dir = await directoryMap(env);
  const to = lower(toRaw);
  const person = dir.get(to);
  if (!person) throw new HttpError(400, 'unknown_person', 'Pick someone from the staff list.');
  const note = cleanBody(noteRaw).slice(0, 2000);
  const now = nowIso();
  const next = await upsertTask(env, row.id, { owner_email: to, sent_by: actor.email, sent_at: now, waiting_on: task?.waiting_on === to ? null : task?.waiting_on ?? null });
  await addFollower(env, row.id, to, 'owner');
  if (FAVOR.test(actor.email)) await addFollower(env, row.id, actor.email, 'sent');
  if (task?.owner_email && task.owner_email !== to) {
    await env.DB.prepare(`UPDATE request_followers SET why = 'sent' WHERE request_id = ? AND email = ? AND why = 'owner'`).bind(row.id, task.owner_email).run();
  }
  let comment: CommentRow | null = null;
  if (note) comment = await saveComment(env, row.id, actor, note, 'send', null);
  const mentioned = mentionsIn(note, dir).filter((e) => e !== to);
  for (const e of mentioned) await addFollower(env, row.id, e, 'mention');
  const told = await tellPeople(env, row.id, actor, [
    { email: to, kind: 'sent', note, comment_id: comment?.id },
    ...mentioned.map((e) => ({ email: e, kind: 'mention' as const, note, comment_id: comment?.id })),
  ]);
  // The history says whether the person heard about it, so nobody has to guess while notices are off.
  await addEvent(env, row.id, 'sent', actor.name, { from: actor.email, from_name: actor.name, to, to_name: person.name, note, told: told.includes(to) });
  await chatCard(env, actor, to, row.id, 'sent', note, told);
  for (const e of mentioned) await chatCard(env, actor, e, row.id, 'mention', note, told);
  return { task: next, comment };
}

function mentionsIn(body: string, dir: Map<string, Person>): string[] {
  return parseMentions(body).people.map(lower).filter((e) => dir.has(e));
}

async function saveComment(env: TaskEnv, requestId: string, actor: Actor, body: string, source: string, chatMessageId: number | null): Promise<CommentRow> {
  const c: CommentRow = {
    id: newId('cmt'),
    request_id: requestId,
    email: actor.email,
    name: actor.name,
    body,
    source,
    chat_message_id: chatMessageId,
    created_at: nowIso(),
    deleted_at: null,
  };
  await env.DB.prepare('INSERT INTO request_comments (id, request_id, email, name, body, source, chat_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(c.id, c.request_id, c.email, c.name, c.body, c.source, c.chat_message_id, c.created_at)
    .run();
  await env.DB.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').bind(c.created_at, requestId).run();
  return c;
}

/**
 * A comment on the request, typed on the board or as a reply under its card in Chat. People mentioned follow the request and
 * hear about it with a Chat card; everyone else following it gets a notice. The comment is copied under each Chat card the
 * author is part of, except the thread it came from.
 */
export async function addComment(
  env: TaskEnv,
  row: RequestRow,
  actor: Actor,
  bodyRaw: unknown,
  from: { source?: 'board' | 'chat'; chatMessageId?: number | null; chatRoot?: number | null } = {}
): Promise<CommentRow & { told: string[] }> {
  const task = await taskOf(env, row.id);
  const st = standingOf(actor, task, await followersOf(env, row.id));
  need(st.admin || st.part);
  const body = cleanBody(bodyRaw);
  if (!body) throw new HttpError(400, 'empty', 'Write a comment first.');
  const dir = await directoryMap(env);
  const c = await saveComment(env, row.id, actor, body, from.source || 'board', from.chatMessageId ?? null);
  if (FAVOR.test(actor.email)) await addFollower(env, row.id, actor.email, 'comment');
  const mentioned = mentionsIn(body, dir).filter((e) => e !== actor.email);
  for (const e of mentioned) await addFollower(env, row.id, e, 'mention');
  const others = (await audience(env, row.id, actor)).filter((e) => !mentioned.includes(e));
  const told = await tellPeople(env, row.id, actor, [
    ...mentioned.map((e) => ({ email: e, kind: 'mention' as const, note: body, comment_id: c.id })),
    ...others.map((e) => ({ email: e, kind: 'comment' as const, note: body, comment_id: c.id })),
  ]);
  if (mentioned.length) await addEvent(env, row.id, 'mention', actor.name, { who: mentioned.map((e) => nameOf(dir, e)), emails: mentioned, told: mentioned.filter((e) => told.includes(e)) });
  // A copy lands under the card in each direct message the author is in (the gate decides as for any notice). Then people named get a
  // card, unless the two already have one for this request: the copy in that thread is their notice in Chat.
  if (FAVOR.test(actor.email)) {
    const gate = await noticeGate(env);
    await copyComment(env, { requestId: row.id, author: actor.email, commentId: c.id, body, exceptRoot: from.chatRoot ?? null, allowed: gate }).catch((err) => console.error('[tasks] copy', err));
  }
  for (const e of mentioned) await chatCard(env, actor, e, row.id, 'mention', body, told);
  return { ...c, told };
}

export async function deleteComment(env: TaskEnv, row: RequestRow, actor: Actor, commentId: string): Promise<void> {
  const c = await env.DB.prepare('SELECT email, deleted_at FROM request_comments WHERE id = ? AND request_id = ?').bind(commentId, row.id).first<{ email: string; deleted_at: string | null }>();
  if (!c || c.deleted_at) throw new HttpError(404, 'not_found', 'That comment is gone.');
  need(c.email === actor.email || actor.admin, 'You can delete your own comments.');
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE request_comments SET deleted_at = ?, body = '' WHERE id = ?`).bind(now, commentId),
    env.DB.prepare('DELETE FROM request_notices WHERE comment_id = ? AND read_at IS NULL').bind(commentId),
  ]);
  // The copies in Chat read as deleted too.
  const copies = await env.DB.prepare(`SELECT message_id FROM request_chat_links WHERE comment_id = ? AND kind = 'copy'`).bind(commentId).all<{ message_id: number }>().catch(() => ({ results: [] as { message_id: number }[] }));
  for (const m of copies.results || []) {
    await env.DB.prepare(`UPDATE chat_messages SET deleted_at = ?, body = '', attachments = '[]' WHERE id = ? AND deleted_at IS NULL`).bind(now, m.message_id).run().catch(() => undefined);
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Due date and Waiting on: the owner or an admin. Waiting on someone tells them. */
export async function setFields(env: TaskEnv, row: RequestRow, actor: Actor, input: { due_date?: unknown; waiting_on?: unknown }): Promise<TaskRow> {
  const task = await taskOf(env, row.id);
  const st = standingOf(actor, task, await followersOf(env, row.id));
  need(st.admin || st.owner, 'Only the owner or a FavorOS admin can change that.');
  const fields: Partial<TaskRow> = {};
  if (input.due_date !== undefined) {
    const d = input.due_date === null || input.due_date === '' ? null : String(input.due_date);
    if (d && (!DAY.test(d) || Number.isNaN(Date.parse(d + 'T12:00:00Z')))) throw new HttpError(400, 'bad_date', 'Pick a date.');
    if (d !== (task?.due_date ?? null)) {
      fields.due_date = d;
      await addEvent(env, row.id, 'due', actor.name, { from: task?.due_date ?? null, to: d });
    }
  }
  let waitTold: string | null = null;
  if (input.waiting_on !== undefined) {
    const w = input.waiting_on === null || input.waiting_on === '' ? null : lower(input.waiting_on);
    const dir = await directoryMap(env);
    if (w && !dir.has(w)) throw new HttpError(400, 'unknown_person', 'Pick someone from the staff list.');
    if (w !== (task?.waiting_on ?? null)) {
      fields.waiting_on = w;
      if (w) {
        await addFollower(env, row.id, w, 'waiting');
        waitTold = w;
      } else await addEvent(env, row.id, 'waiting', actor.name, { email: null, name: null });
    }
  }
  const next = Object.keys(fields).length ? await upsertTask(env, row.id, fields) : task || (await upsertTask(env, row.id, {}));
  if (waitTold) {
    const told = await tellPeople(env, row.id, actor, [{ email: waitTold, kind: 'waiting', note: '' }]);
    const dir = await directoryMap(env);
    await addEvent(env, row.id, 'waiting', actor.name, { email: waitTold, name: nameOf(dir, waitTold), told: told.includes(waitTold) });
  }
  return next;
}

/**
 * Status by someone on the request who is not an admin: Mark done, or Reopen a done request. Done emails the person who asked
 * (the same email the board has always sent) and tells the followers.
 */
export async function participantStatus(env: TaskEnv, row: RequestRow, actor: Actor, status: 'done' | 'in_progress'): Promise<RequestRow> {
  const task = await taskOf(env, row.id);
  const st = standingOf(actor, task, await followersOf(env, row.id));
  need(st.admin || st.part);
  if (status === 'done' && (row.status === 'done' || row.status === 'declined')) throw new HttpError(400, 'bad_status', 'This request is already closed.');
  if (status === 'in_progress' && row.status !== 'done') throw new HttpError(400, 'bad_status', 'Only a done request can be reopened.');
  const next = await setStatus(env, row.id, status, actor.name);
  if (status === 'done') {
    await tellPeople(env, row.id, actor, (await audience(env, row.id, actor)).map((e) => ({ email: e, kind: 'done' as const, note: '' })));
  }
  return next;
}

/** Notices for followers when an admin moves a card to Done on the board. */
export async function toldDone(env: TaskEnv, requestId: string, actor: Actor): Promise<void> {
  if (!(await tasksReady(env))) return;
  await tellPeople(env, requestId, actor, (await audience(env, requestId, actor)).map((e) => ({ email: e, kind: 'done' as const, note: '' })));
}

/* ------------------------------------------------------------------------------------------------ shapes */

export interface TaskOut {
  owner: string | null;
  sent_by: string | null;
  sent_at: string | null;
  due_date: string | null;
  waiting_on: string | null;
  followers: string[];
  comments: number;
  unread: number;
}

/** The task fields for the board's cards, for many requests at once. */
export async function tasksFor(env: TaskEnv, ids: string[], me: string): Promise<Map<string, TaskOut>> {
  const out = new Map<string, TaskOut>();
  if (!ids.length || !(await tasksReady(env))) return out;
  const blank = (): TaskOut => ({ owner: null, sent_by: null, sent_at: null, due_date: null, waiting_on: null, followers: [], comments: 0, unread: 0 });
  const [tasks, fol, com, unread] = await Promise.all([
    env.DB.prepare('SELECT request_id, owner_email, sent_by, sent_at, due_date, waiting_on FROM request_tasks').all<TaskRow>(),
    env.DB.prepare('SELECT request_id, email FROM request_followers WHERE muted = 0 ORDER BY created_at').all<{ request_id: string; email: string }>(),
    env.DB.prepare('SELECT request_id, COUNT(*) AS n FROM request_comments WHERE deleted_at IS NULL GROUP BY request_id').all<{ request_id: string; n: number }>(),
    env.DB.prepare('SELECT request_id, COUNT(*) AS n FROM request_notices WHERE email = ? AND read_at IS NULL GROUP BY request_id').bind(lower(me)).all<{ request_id: string; n: number }>(),
  ]);
  const want = new Set(ids);
  const get = (id: string) => out.get(id) || (out.set(id, blank()), out.get(id)!);
  for (const t of tasks.results || []) {
    if (!want.has(t.request_id)) continue;
    Object.assign(get(t.request_id), { owner: t.owner_email, sent_by: t.sent_by, sent_at: t.sent_at, due_date: t.due_date, waiting_on: t.waiting_on });
  }
  for (const f of fol.results || []) if (want.has(f.request_id)) get(f.request_id).followers.push(f.email);
  for (const c of com.results || []) if (want.has(c.request_id)) get(c.request_id).comments = Number(c.n) || 0;
  for (const u of unread.results || []) if (want.has(u.request_id)) get(u.request_id).unread = Number(u.n) || 0;
  return out;
}

export interface DetailOut {
  task: TaskOut;
  comments: Array<{ id: string; email: string; name: string; body: string; source: string; created_at: string; deleted: boolean }>;
  can: { triage: boolean; send: boolean; comment: boolean; done: boolean; edit: boolean; follow: boolean };
  following: boolean;
  /** Whether the owner and the person waited on have been told, and whether notices can reach them now. */
  told: { owner: Told | null; waiting: Told | null };
}

export async function detailFor(env: TaskEnv, row: RequestRow, actor: Actor | null): Promise<DetailOut | null> {
  if (!(await tasksReady(env))) return null;
  const [task, followers, comments] = await Promise.all([taskOf(env, row.id), followersOf(env, row.id), commentsOf(env, row.id)]);
  const st = actor ? standingOf(actor, task, followers) : { admin: false, owner: false, part: false, following: false };
  const unread = actor
    ? Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM request_notices WHERE email = ? AND request_id = ? AND read_at IS NULL').bind(actor.email, row.id).first<{ n: number }>().catch(() => null))?.n) || 0
    : 0;
  const open = row.status !== 'done' && row.status !== 'declined';
  return {
    task: {
      owner: task?.owner_email ?? null,
      sent_by: task?.sent_by ?? null,
      sent_at: task?.sent_at ?? null,
      due_date: task?.due_date ?? null,
      waiting_on: task?.waiting_on ?? null,
      followers: followers.filter((f) => !f.muted).map((f) => f.email),
      comments: comments.filter((c) => !c.deleted_at).length,
      unread,
    },
    comments: comments.map((c) => ({ id: c.id, email: c.email, name: c.name, body: c.deleted_at ? '' : c.body, source: c.source, created_at: c.created_at, deleted: !!c.deleted_at })),
    can: {
      triage: st.admin,
      send: st.admin || st.owner,
      comment: st.admin || st.part,
      done: (st.admin || st.part) && open,
      edit: st.admin || st.owner,
      follow: !!actor && FAVOR.test(actor.email),
    },
    following: st.following,
    told: await toldFor(env, row.id, task),
  };
}

/**
 * Tell the owner or the person waited on now, for a hand-off made while notices were off. Nothing is ever sent for an old
 * event by itself; this is the button a person presses. The gate still decides.
 */
export async function tellNow(env: TaskEnv, row: RequestRow, actor: Actor, emailRaw: unknown): Promise<boolean> {
  const task = await taskOf(env, row.id);
  const st = standingOf(actor, task, await followersOf(env, row.id));
  need(st.admin || st.owner, 'Only the owner or a FavorOS admin can do that.');
  const email = lower(emailRaw);
  const kind = task?.owner_email === email ? 'sent' : task?.waiting_on === email ? 'waiting' : null;
  if (!kind) throw new HttpError(400, 'not_on_it', 'That person is not the owner or the person waited on.');
  const had = await env.DB.prepare('SELECT 1 AS ok FROM request_notices WHERE request_id = ? AND email = ? AND kind = ? LIMIT 1').bind(row.id, email, kind).first();
  if (had) return true;
  const first = kind === 'sent' ? (await commentsOf(env, row.id)).find((c) => c.source === 'send' && !c.deleted_at)?.body || '' : '';
  const told = await tellPeople(env, row.id, actor, [{ email, kind, note: first }]);
  if (!told.includes(email)) throw new HttpError(409, 'notices_off', 'Request notices are off, so nobody can be told yet.');
  if (kind === 'sent') await chatCard(env, actor, email, row.id, 'sent', first, told);
  await addEvent(env, row.id, 'told', actor.name, { email, name: nameOf(await directoryMap(env), email), about: kind });
  return true;
}

/** The request when this person may see it: anyone signed in reads the board; a declined request is for admins and people on it. */
export async function readable(env: TaskEnv, id: string, actor: Actor | null): Promise<RequestRow> {
  const row = await getRequest(env, id);
  if (!row) throw new HttpError(404, 'not_found', 'Request not found');
  if (row.status === 'declined' && !actor?.admin) {
    const st = actor && (await tasksReady(env)) ? standingOf(actor, await taskOf(env, id), await followersOf(env, id)) : null;
    if (!st || !st.part) throw new HttpError(404, 'not_found', 'Request not found');
  }
  return row;
}
