// Projects in Favor Chat.
//   a channel   every project can have one, made on demand (ensureProjectChannel); its members follow the project's.
//   a card      a task posted in a conversation as a Chat message with a {type: 'ptask'} attachment. It opens in place and reads the
//               task as it is now (title, status, owner, due date), so it never goes stale.
//   /task       typed in any conversation, makes a task and posts its card (slashTask, called from the Chat route).
//   a message   "Make a task from this message" (taskFromMessage).
//   a reply     typed under a card in Chat becomes a comment on the task; a comment written in the hub is copied under the latest
//               card in each conversation its author is part of (the way the request board does it in chat/tasks.ts).
// hub_task_chat_links ties each Chat message to its task. Nothing here notifies anyone the notice gate does not allow.
import { HttpError, nowIso, type Env } from '../../http';
import * as store from '../../chat/db';
import { hydrateAttachments } from '../../chat/hydrate';
import { publish, type LiveEnv } from '../../chat/live';
import { channelSlug, cleanBody, parseMentions, plainLine } from '../../chat/text';
import { modeAllows, projectsMode, type Actor } from '../access';
import { lower, projectOf, projectsReady, type ProjectRow, type TaskRow } from '../db';
import { addComment, createTask, taskAccess } from '../tasks';
import { FAVOR, STATUS_WORD, dirMap, dueLabel, nameOf, noticeGate, plain, taskLine, taskUrl, todayEt, addDays, type TaskLine } from './shared';

type ChatEnv = Env & Partial<LiveEnv>;

/* ------------------------------------------------------------------------------------------------ links */

async function link(env: ChatEnv, m: { message_id: number; task_id: string; channel_id: string; root_id: number | null; comment_id: string | null; kind: string }): Promise<void> {
  await env.DB.prepare('INSERT OR REPLACE INTO hub_task_chat_links (message_id, task_id, channel_id, root_id, comment_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(m.message_id, m.task_id, m.channel_id, m.root_id, m.comment_id, m.kind, nowIso())
    .run();
}

/** The Chat mention rows a message would add are removed for people the task board already told, so the bell counts each thing once. */
async function quiet(env: ChatEnv, messageId: number, emails?: string[]): Promise<void> {
  if (!emails) {
    await env.DB.prepare('DELETE FROM chat_mentions WHERE message_id = ?').bind(messageId).run();
    return;
  }
  for (const e of emails) await env.DB.prepare('DELETE FROM chat_mentions WHERE message_id = ? AND email = ?').bind(messageId, lower(e)).run();
}

async function live(env: ChatEnv, row: store.MessageRow, type: 'message' | 'edit' = 'message'): Promise<void> {
  if (!env.CHAT_ROOM) return;
  const [msg] = await store.shape(env, [row], (x) => hydrateAttachments(env, x));
  await publish(env as LiveEnv, store.audienceOf(row, await store.membersOf(env, row.channel_id)), { type, message: msg });
}

/* ------------------------------------------------------------------------------------------------ the channel */

/**
 * The project's Chat channel, made when it is missing. A project anyone can open gets a public channel, a members-only project a
 * private one. The lead and every member are added; people added to the project later join on the next call.
 */
export async function ensureProjectChannel(env: ChatEnv, project: ProjectRow, actorEmail: string): Promise<{ id: string; name: string; created: boolean }> {
  const members = new Set<string>([lower(project.lead_email)]);
  for (const m of (await env.DB.prepare('SELECT email FROM hub_project_members WHERE project_id = ?').bind(project.id).all<{ email: string }>()).results || []) members.add(lower(m.email));
  const now = nowIso();
  let ch = project.chat_channel_id ? await store.getChannel(env, project.chat_channel_id) : null;
  let created = false;
  if (!ch) {
    const owner = FAVOR.test(lower(actorEmail)) ? lower(actorEmail) : lower(project.lead_email);
    const base = channelSlug(`proj ${project.key}`) || 'project';
    let made: store.ChannelOut | null = null;
    for (let i = 0; i < 6 && !made; i++) {
      try {
        made = await store.createChannel(env, owner, { name: i ? `${base}-${i + 1}` : base, topic: project.name.slice(0, 200), private: project.visibility === 'members' });
      } catch (err) {
        if (!(err instanceof HttpError) || err.code !== 'name_taken') throw err;
      }
    }
    if (!made) throw new HttpError(409, 'name_taken', 'Could not find a free channel name for this project.');
    await env.DB.prepare('UPDATE hub_projects SET chat_channel_id = ?, updated_at = ? WHERE id = ?').bind(made.id, now, project.id).run();
    ch = (await store.getChannel(env, made.id))!;
    created = true;
  }
  const have = new Set(await store.membersOf(env, ch.id));
  const add = [...members].filter((e) => FAVOR.test(e) && !have.has(e));
  if (add.length) await env.DB.batch(add.map((e) => env.DB.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`).bind(ch!.id, e, now)));
  return { id: ch.id, name: ch.name, created };
}

/** The project whose channel this is, when it is one. */
export async function projectOfChannel(env: Env, channelId: string): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT * FROM hub_projects WHERE chat_channel_id = ? LIMIT 1').bind(channelId).first<ProjectRow>().catch(() => null);
}

/* ------------------------------------------------------------------------------------------------ cards */

export type CardKind = 'created' | 'assigned' | 'mention' | 'shared';

/** Posts the task's card in a conversation, as the person who is sharing it. Returns the message id. */
export async function postCard(
  env: ChatEnv,
  input: { taskId: string; channelId: string; from: string; kind: CardKind; note?: string; thread?: number | null; quietFor?: string[] | 'all' }
): Promise<number> {
  const posted = await store.post(env, {
    channel_id: input.channelId,
    email: lower(input.from),
    body: '',
    thread_id: input.thread || null,
    attachments: [{ type: 'ptask', id: input.taskId, kind: input.kind, note: String(input.note || '').slice(0, 600) }],
  });
  const id = posted.message.id;
  await link(env, { message_id: id, task_id: input.taskId, channel_id: input.channelId, root_id: input.thread || null, comment_id: null, kind: 'card' });
  if (input.quietFor === 'all') await quiet(env, id);
  else if (input.quietFor?.length) await quiet(env, id, input.quietFor);
  await live(env, posted.message).catch(() => undefined);
  return id;
}

/** A card in the direct message between two people. */
export async function postDirectCard(env: ChatEnv, input: { taskId: string; from: string; to: string; kind: CardKind; note?: string }): Promise<number> {
  const ch = await store.openConversation(env, lower(input.from), [lower(input.to)]);
  return postCard(env, { taskId: input.taskId, channelId: ch.id, from: input.from, kind: input.kind, note: input.note, quietFor: 'all' });
}

const KICK: Record<string, string> = { created: 'Made a task', assigned: 'Gave you a task', mention: 'Named you on a task', shared: 'Shared a task' };

/** Fills each task card from the task as it is now. A task that is gone reads as a link card. */
export async function hydratePTaskCards(env: Env, list: store.Attachment[]): Promise<store.Attachment[]> {
  const ids = [...new Set(list.filter((a) => a.type === 'ptask' && typeof a.id === 'string').map((a) => String(a.id)))];
  if (!ids.length) return list;
  const lines = new Map<string, TaskLine>();
  for (const id of ids) {
    const t = await taskLine(env, id);
    if (t) lines.set(id, t);
  }
  const dir = await dirMap(env);
  return list.map((a) => {
    if (a.type !== 'ptask') return a;
    const t = lines.get(String(a.id));
    if (!t || t.status === 'dropped') return { type: 'link', url: '#', host: 'Task', title: 'This task is no longer on the board' };
    const kind = String(a.kind || 'created');
    return {
      type: 'ptask',
      id: t.id,
      code: t.code || '',
      kind,
      kick: KICK[kind] || 'Task',
      note: String(a.note || ''),
      title: t.title,
      status: t.status,
      status_label: STATUS_WORD[t.status] || t.status,
      owner: t.owner_email ? nameOf(dir, t.owner_email) : '',
      due_date: t.due_date || '',
      due: dueLabel(t.due_date, t.due_time),
      late: !!t.due_date && t.due_date < todayEt() && t.status !== 'done',
      project: t.project_key ? { key: t.project_key, name: t.project_name || '', color: t.project_color || '' } : null,
      url: taskUrl(t, t.project_key ? { key: t.project_key } : null),
    };
  });
}

/** After a task changes, every open Chat window redraws its cards. */
export async function refreshCards(env: ChatEnv, taskId: string): Promise<void> {
  if (!env.CHAT_ROOM) return;
  const rows = (await env.DB.prepare(`SELECT message_id FROM hub_task_chat_links WHERE task_id = ? AND kind = 'card' ORDER BY message_id DESC LIMIT 12`).bind(taskId).all<{ message_id: number }>()).results || [];
  for (const r of rows) {
    const row = await store.getMessage(env, r.message_id);
    if (row && !row.deleted_at) await live(env, row, 'edit').catch(() => undefined);
  }
}

/* ------------------------------------------------------------------------------------------------ both ways */

/** The task a card belongs to, when this message is one. */
export async function cardTask(env: Env, messageId: number): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT task_id FROM hub_task_chat_links WHERE message_id = ? AND kind = 'card'`).bind(messageId).first<{ task_id: string }>().catch(() => null);
  return r?.task_id || null;
}

/**
 * Called by Chat after a reply is posted in a thread. A reply under a task card becomes a comment on the task; anything else is
 * left alone. Never throws: Chat's own post already succeeded.
 */
export async function taskReply(env: ChatEnv, row: store.MessageRow, user: { email: string; name: string; role: string }): Promise<void> {
  try {
    if (!row.thread_id || row.visible_to) return;
    const taskId = await cardTask(env, row.thread_id);
    if (!taskId) return;
    const atts = (() => {
      try {
        return JSON.parse(row.attachments || '[]') as unknown[];
      } catch {
        return [];
      }
    })();
    const body = row.body || (atts.length ? 'Shared an attachment in Chat.' : '');
    if (!body) return;
    const actor: Actor = { email: lower(row.email), name: user.name || row.email, admin: user.role === 'admin' };
    const r = await addComment(env, actor, taskId, { body }, { source: 'chat', chat_message_id: String(row.id) });
    await link(env, { message_id: row.id, task_id: taskId, channel_id: row.channel_id, root_id: row.thread_id, comment_id: r.comment.id, kind: 'reply' });
    if (r.told.length) await quiet(env, row.id, r.told);
    const { fire } = await import('../hooks');
    await fire(env, { kind: 'task.comment', actor: actor.email, actorName: actor.name, task: r.task, project: r.project, detail: { comment: r.comment }, told: r.told });
  } catch (err) {
    console.warn('[projects] chat reply', err);
  }
}

/** Called by Chat after a message is deleted: a reply that became a comment is deleted on the task too. */
export async function taskDeleted(env: ChatEnv, messageId: number): Promise<void> {
  try {
    const r = await env.DB.prepare(`SELECT comment_id FROM hub_task_chat_links WHERE message_id = ? AND kind = 'reply'`).bind(messageId).first<{ comment_id: string }>();
    if (!r?.comment_id) return;
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(`UPDATE hub_task_comments SET deleted_at = ?, body = '' WHERE id = ? AND deleted_at IS NULL`).bind(now, r.comment_id),
      env.DB.prepare(`DELETE FROM hub_task_notices WHERE kind IN ('comment', 'mentioned') AND read_at IS NULL AND task_id = (SELECT task_id FROM hub_task_comments WHERE id = ?) AND created_at >= (SELECT created_at FROM hub_task_comments WHERE id = ?)`).bind(r.comment_id, r.comment_id),
    ]);
  } catch {
    // Nothing to undo.
  }
}

/**
 * A comment written in the hub lands under the latest card in each conversation its author is part of, except the thread it came
 * from. A copy goes only where someone else there may hear about it (the notice gate), and never to people who get a fresh card.
 */
export async function copyComment(
  env: ChatEnv,
  input: { taskId: string; author: string; commentId: string; body: string; exceptRoot: number | null; allowed: (email: string) => boolean }
): Promise<number[]> {
  const author = lower(input.author);
  const cards = await env.DB.prepare(`SELECT channel_id, MAX(message_id) AS root FROM hub_task_chat_links WHERE task_id = ? AND kind = 'card' GROUP BY channel_id`)
    .bind(input.taskId)
    .all<{ channel_id: string; root: number }>();
  let skip = '';
  if (input.exceptRoot) {
    const from = await env.DB.prepare('SELECT channel_id FROM hub_task_chat_links WHERE message_id = ?').bind(input.exceptRoot).first<{ channel_id: string }>();
    skip = from?.channel_id || '';
  }
  const made: number[] = [];
  for (const c of cards.results || []) {
    if (c.channel_id === skip) continue;
    const members = await store.membersOf(env, c.channel_id);
    if (!members.includes(author)) continue;
    if (!members.filter((m) => m !== author).some((m) => input.allowed(m))) continue;
    const posted = await store.post(env, { channel_id: c.channel_id, email: author, body: input.body, thread_id: c.root });
    await link(env, { message_id: posted.message.id, task_id: input.taskId, channel_id: c.channel_id, root_id: c.root, comment_id: input.commentId, kind: 'copy' });
    await quiet(env, posted.message.id);
    await live(env, posted.message).catch(() => undefined);
    made.push(posted.message.id);
  }
  return made;
}

/** The chat side of a hub event: cards for people who were told, comment copies, and fresh status on open cards. */
export async function onEvent(env: ChatEnv, ev: { kind: string; actor: string; task?: TaskRow | null; project?: ProjectRow | null; detail?: Record<string, unknown>; told?: string[] }): Promise<void> {
  const t = ev.task;
  if (!t) return;
  const actor = lower(ev.actor);
  const told = (ev.told || []).map(lower);
  if ((ev.kind === 'task.assigned' || (ev.kind === 'task.created' && t.owner_email)) && ev.detail?.from !== 'chat') {
    const to = lower(t.owner_email);
    if (to && to !== actor && told.includes(to) && FAVOR.test(actor)) await postDirectCard(env, { taskId: t.id, from: actor, to, kind: 'assigned', note: '' }).catch((err) => console.error('[projects] card', err));
  }
  if (ev.kind === 'task.comment') {
    const c = (ev.detail?.comment || {}) as { id?: string; body?: string; mentions?: string[]; source?: string; chat_message_id?: string | null };
    if (c.id && c.body && FAVOR.test(actor)) {
      const gate = await noticeGate(env);
      const named = (c.mentions || []).map(lower).filter((e) => told.includes(e) && e !== actor);
      let root: number | null = null;
      if (c.source === 'chat' && c.chat_message_id) root = Number((await env.DB.prepare('SELECT root_id FROM hub_task_chat_links WHERE message_id = ?').bind(Number(c.chat_message_id)).first<{ root_id: number }>().catch(() => null))?.root_id) || null;
      await copyComment(env, { taskId: t.id, author: actor, commentId: c.id, body: c.body, exceptRoot: root, allowed: (e) => gate(e) && !named.includes(lower(e)) }).catch((err) => console.error('[projects] copy', err));
      for (const e of named) await postDirectCard(env, { taskId: t.id, from: actor, to: e, kind: 'mention', note: c.body }).catch((err) => console.error('[projects] card', err));
    }
  }
  if (['task.updated', 'task.done', 'task.reopened', 'task.assigned', 'task.waiting', 'task.moved'].includes(ev.kind)) await refreshCards(env, t.id);
}

/* ------------------------------------------------------------------------------------------------ making tasks from Chat */

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "today", "tomorrow", "friday", "next friday", "10/31", "oct 31", "2026-10-31" as a date (Eastern), or null. */
export function parseWhen(text: string, now = new Date()): string | null {
  const t = String(text || '').trim().toLowerCase().replace(/[.,]+$/, '');
  if (!t) return null;
  const today = todayEt(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Number.isNaN(Date.parse(t + 'T12:00:00Z')) ? null : t;
  if (t === 'today' || t === 'eod') return today;
  if (t === 'tomorrow' || t === 'tmrw') return addDays(today, 1);
  const wd = /^(?:next |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(t);
  if (wd) {
    const dow = new Date(today + 'T12:00:00Z').getUTCDay();
    const want = WEEKDAYS.indexOf(wd[1]);
    // "friday" is the next one coming; "next friday" is the one in the week after this week ends.
    if (t.startsWith('next ')) {
      const nextMonday = addDays(today, (8 - dow) % 7 || 7);
      return addDays(nextMonday, (want + 6) % 7);
    }
    return addDays(today, (want - dow + 7) % 7 || 7);
  }
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  const word = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})$/.exec(t);
  let m = 0, d = 0, y = Number(today.slice(0, 4));
  if (slash) {
    m = Number(slash[1]);
    d = Number(slash[2]);
    if (slash[3]) y = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
  } else if (word) {
    m = MONTHS.indexOf(word[1]) + 1;
    d = Number(word[2]);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (Number.isNaN(Date.parse(day + 'T12:00:00Z'))) return null;
  // A month and day with no year that already passed means next year.
  if (!slash?.[3] && day < today) day = `${y + 1}-${day.slice(5)}`;
  return day;
}

export interface Slash {
  title: string;
  project: string | null;
  owner: string | null;
  due: string | null;
}

/**
 * /task [KEY] a title [@person] [due friday]. The key is a project key the person can open. @person is a mention the composer
 * inserted (<@email>) or a first name the staff directory resolves to one person. Null when the text is not a /task command.
 */
export async function parseSlash(env: Env, text: string, keys: Set<string>): Promise<Slash | null> {
  const m = /^\/task(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  if (!m) return null;
  let rest = (m[1] || '').trim();
  let project: string | null = null;
  const k = /^([A-Za-z]{2,5})\s+/.exec(rest);
  if (k && keys.has(k[1].toUpperCase())) {
    project = k[1].toUpperCase();
    rest = rest.slice(k[0].length).trim();
  }
  let due: string | null = null;
  const d = /\s(?:due|by)\s+((?:next\s+|this\s+)?[a-z0-9/\-]+(?:\s+\d{1,2})?)\s*$/i.exec(' ' + rest);
  if (d) {
    const when = parseWhen(d[1]);
    if (when) {
      due = when;
      rest = rest.slice(0, rest.length - (d[0].length - 1)).trim();
    }
  }
  const dir = await dirMap(env);
  let owner: string | null = null;
  const tok = parseMentions(rest).people.filter((e) => dir.has(e));
  if (tok.length) owner = tok[0];
  rest = rest.replace(/<@[^>\s]+>/g, ' ');
  if (!owner) {
    const at = /(^|\s)@([A-Za-z][A-Za-z'-]+)(?=\s|$|[.,;:!?])/.exec(rest);
    if (at) {
      const first = at[2].toLowerCase();
      const hits = [...dir.values()].filter((p) => p.name.toLowerCase().split(/\s+/)[0] === first);
      if (hits.length === 1) {
        owner = hits[0].email;
        rest = rest.replace(at[0], at[1]);
      }
    }
  }
  const title = rest.replace(/\s+/g, ' ').trim().slice(0, 300);
  return { title, project, owner, due };
}

/** Project keys this person can open, for the /task command. */
async function keysFor(env: Env, actor: Actor): Promise<Set<string>> {
  const { visibleProject } = await import('../access');
  const v = visibleProject(actor, 'p');
  const r = await env.DB.prepare(`SELECT p.key FROM hub_projects p WHERE p.status <> 'archived' AND ${v.sql}`).bind(...v.args).all<{ key: string }>().catch(() => ({ results: [] as { key: string }[] }));
  return new Set((r.results || []).map((x) => x.key.toUpperCase()));
}

/**
 * The /task command, called by the Chat route before a message is saved. Returns the posted card as Chat shows it, or null when the
 * text is not a /task command. A command with no title answers with a plain message so Chat shows what to type.
 */
export async function slashTask(
  env: ChatEnv,
  user: { email: string; name: string; role: string; via?: string },
  channelId: string,
  text: string,
  threadId: number | null
): Promise<store.MessageOut | null> {
  if (!/^\/task(\s|$)/i.test(String(text || '').trim())) return null;
  // With Projects off (or not set up) the text posts as typed.
  if (!modeAllows(await projectsMode(env), { admin: user.role === 'admin' }) || !(await projectsReady(env))) return null;
  const actor: Actor = { email: lower(user.email), name: user.name || user.email, admin: user.role === 'admin' };
  const ch = await store.postableChannel(env, channelId, actor.email);
  const parsed = await parseSlash(env, text, await keysFor(env, actor));
  if (!parsed || !parsed.title) throw new HttpError(400, 'task_title', 'Type /task and what needs doing, for example /task Send the report to Dana due friday.');
  const projectOfChan = await projectOfChannel(env, ch.id);
  const members = await store.membersOf(env, ch.id);
  const others = members.filter((m) => m !== actor.email);
  // In a direct message the other person is the owner unless someone is named; elsewhere the writer is.
  const owner = parsed.owner || (ch.kind === 'dm' && others.length === 1 ? others[0] : actor.email);
  const project = parsed.project ? await projectOf(env, parsed.project) : projectOfChan;
  const made = await createTask(env, actor, {
    title: parsed.title,
    project_id: project?.id,
    owner_email: owner,
    due_date: parsed.due || undefined,
    description: `Made in Chat by ${actor.name}.`,
  });
  const { fire } = await import('../hooks');
  if (!made.existing) await fire(env, { kind: 'task.created', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'chat' }, told: made.told });
  const id = await postCard(env, { taskId: made.task.id, channelId: ch.id, from: actor.email, kind: 'created', thread: threadId, quietFor: 'all' });
  const row = (await store.getMessage(env, id))!;
  const [msg] = await store.shape(env, [row], (x) => hydrateAttachments(env, x));
  return msg;
}

/** "Make a task from this message": the message's text becomes the title and description, and a card is posted under the message. */
export async function taskFromMessage(
  env: ChatEnv,
  actor: Actor,
  input: { message_id: number; title?: string; project?: string | null; owner?: string | null; due?: string | null }
): Promise<{ task: TaskRow; project: ProjectRow | null; message_id: number; existing: boolean }> {
  const msg = await store.getMessage(env, Number(input.message_id));
  if (!msg || msg.deleted_at || !store.canSee(msg, actor.email)) throw new HttpError(404, 'not_found', 'That message is gone.');
  const ch = await store.readableChannel(env, msg.channel_id, actor.email);
  const dir = await dirMap(env);
  const text = plainLine(msg.body, (id) => nameOf(dir, id), 4000) || 'Message with an attachment';
  const first = text.split(/(?<=[.!?])\s|\n/)[0] || text;
  const title = cleanBody(input.title || first).slice(0, 140) || 'Task from Chat';
  const projectOfChan = await projectOfChannel(env, ch.id);
  const project = input.project ? await projectOf(env, String(input.project)) : projectOfChan;
  const who = nameOf(dir, msg.email);
  const base = `/chat/?c=${encodeURIComponent(msg.channel_id)}&m=${msg.id}${msg.thread_id ? '&t=' + msg.thread_id : ''}`;
  const made = await createTask(env, actor, {
    title,
    project_id: project?.id,
    owner_email: input.owner || actor.email,
    due_date: input.due || undefined,
    description: `${text}\n\nFrom ${who} in Chat: ${base}`,
    chat_message_id: String(msg.id),
  });
  const { fire } = await import('../hooks');
  if (!made.existing) await fire(env, { kind: 'task.created', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'chat', message: msg.id }, told: made.told });
  let cardId = 0;
  if (!made.existing) {
    // The card goes in the conversation as a reply under the message, so it sits with what it came from.
    cardId = await postCard(env, { taskId: made.task.id, channelId: msg.channel_id, from: actor.email, kind: 'created', thread: msg.thread_id || msg.id, quietFor: 'all' });
    await link(env, { message_id: msg.id, task_id: made.task.id, channel_id: msg.channel_id, root_id: null, comment_id: null, kind: 'source' });
  }
  return { task: made.task, project: made.project, message_id: cardId, existing: made.existing };
}

/** Shares a task into a channel or conversation the person is part of. */
export async function shareTask(env: ChatEnv, actor: Actor, taskId: string, channelId: string): Promise<number> {
  await store.postableChannel(env, channelId, actor.email);
  const { task } = await taskAccess(env, actor, taskId);
  const t = await taskLine(env, task.id);
  if (!t) throw new HttpError(404, 'not_found', 'Task not found.');
  return postCard(env, { taskId: t.id, channelId, from: actor.email, kind: 'shared', quietFor: 'all' });
}

export { plain };
