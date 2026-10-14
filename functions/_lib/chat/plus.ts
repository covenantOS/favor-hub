// Favor Chat, 2026-10-14 additions. Typed commands and the routes behind their cards:
//   /remind [me|here|#channel|@person] <when> <what>   a bell reminder for me, or a reminder posted into a conversation
//   /schedule <when> <message>                         the message posts later, as the writer
//   /todo [Title:] item; item @person fri; item        a checklist; every line is a Projects task (done syncs both ways)
//   /poll Question | choice | choice                   a poll (/poll multi ... lets people pick more than one)
//   /meet <when> [title]                               books a meeting with the conversation's people; notes come back here
//   /status <text> [until <when>]  /away [until <when>] [note]  /back
//   /scheduled                                         what I have waiting to post, with Cancel
// Routes: GET scheduled, POST scheduled/:id/cancel|now, POST channels/:id/schedule, POST messages/:id/vote|check|check-add,
// GET|POST status. runScheduled posts what is due (the drain Worker's 5 minute pass, and any Chat or dock load).
import { HttpError, newId, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import * as store from './db';
import { hydrateAttachments } from './hydrate';
import { publish, type LiveEnv } from './live';
import { pushForPost, type PushEnv } from '../push';
import { addReminders, checkInput } from '../work/remind';
import { readWhen, whenLabel } from './when';
import { plainLine } from './text';
import { modeAllows, projectsMode } from '../projects/access';
import { projectsReady } from '../projects/db';
import { createTask, patchTask } from '../projects/tasks';
import { parseSlash, projectOfChannel } from '../projects/links/chat';
import { createMeeting } from '../meetroute';
import type { MeetEnv } from '../meet';

type PlusEnv = Env & Partial<LiveEnv> & Partial<PushEnv>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const COMMANDS = /^\/(remind|schedule|todo|checklist|poll|meet|status|away|back|scheduled)(?:\s+([\s\S]*))?$/i;

export async function plusReady(env: Env): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_scheduled'`).first().catch(() => null);
  return !!r;
}

async function shaped(env: Env, row: store.MessageRow): Promise<store.MessageOut> {
  const [m] = await store.shape(env, [row], (x, ch) => hydrateAttachments(env, x, ch));
  return m;
}

async function live(env: PlusEnv, row: store.MessageRow, type: 'message' | 'edit'): Promise<store.MessageOut> {
  const msg = await shaped(env, row);
  if (env.CHAT_ROOM) await publish(env as LiveEnv, store.audienceOf(row, await store.membersOf(env, row.channel_id)), { type, message: msg }).catch(() => undefined);
  return msg;
}

/** A message only the writer sees: the confirmation of a reminder or a scheduled message, or a short how-to. */
async function note(env: PlusEnv, me: string, channelId: string, threadId: number | null, att: store.Attachment): Promise<store.MessageOut> {
  const posted = await store.post(env, { channel_id: channelId, email: me, body: '', thread_id: threadId, attachments: [att], visible_to: me });
  return shaped(env, posted.message);
}
const tip = (env: PlusEnv, me: string, ch: string, th: number | null, text: string) => note(env, me, ch, th, { type: 'note', kind: 'tip', text });

async function nameOf(env: Env, email: string): Promise<string> {
  const r = await env.DB.prepare('SELECT name FROM hub_users WHERE lower(email) = ?').bind(lower(email)).first<{ name: string }>().catch(() => null);
  return r?.name || email.split('@')[0];
}

/* ------------------------------------------------------------------------------------------------ typed commands */

export interface SlashCtx {
  env: PlusEnv;
  user: HubUser;
  channelId: string;
  text: string;
  threadId: number | null;
  origin: string;
  now?: Date;
}

/** Runs a command typed in the message box. Null when the text is not one of these commands (it then posts as typed). */
export async function plusSlash(c: SlashCtx): Promise<store.MessageOut | null> {
  const m = COMMANDS.exec(String(c.text || '').trim());
  if (!m || !(await plusReady(c.env))) return null;
  const cmd = m[1].toLowerCase();
  const rest = (m[2] || '').trim();
  const me = lower(c.user.email);
  await store.postableChannel(c.env, c.channelId, me);
  if (cmd === 'remind') return remind(c, rest);
  if (cmd === 'schedule') return schedule(c, rest);
  if (cmd === 'todo' || cmd === 'checklist') return checklist(c, rest);
  if (cmd === 'poll') return poll(c, rest);
  if (cmd === 'meet') return meet(c, rest);
  if (cmd === 'scheduled') return note(c.env, me, c.channelId, c.threadId, { type: 'note', kind: 'list', items: await waitingList(c.env, me) });
  return status(c, cmd, rest);
}

async function remind(c: SlashCtx, rest: string): Promise<store.MessageOut> {
  const me = lower(c.user.email);
  const now = c.now || new Date();
  let target: 'me' | 'here' | string = 'me';
  let s = rest;
  let mm: RegExpExecArray | null;
  if ((mm = /^me\b\s*/i.exec(s))) s = s.slice(mm[0].length);
  else if ((mm = /^(here|us|everyone|channel)\b\s*/i.exec(s))) {
    target = 'here';
    s = s.slice(mm[0].length);
  } else if ((mm = /^<#([^>|]+)(?:\|[^>]*)?>\s*/.exec(s)) || (mm = /^#([a-z0-9][a-z0-9_-]*)\s*/i.exec(s))) {
    target = '#' + mm[1];
    s = s.slice(mm[0].length);
  } else if ((mm = /^<@([^>]+)>\s*/.exec(s))) {
    target = '@' + lower(mm[1]);
    s = s.slice(mm[0].length);
  }
  const w = readWhen(s, now);
  if (!w || !w.rest) return tip(c.env, me, c.channelId, c.threadId, 'Type /remind me tomorrow 9am to call Grace, or /remind #channel friday 3pm send the photos. Times are Eastern.');
  if (target === 'me') {
    const ch = await store.getChannel(c.env, c.channelId);
    const where = ch && (ch.kind === 'public' || ch.kind === 'private') ? `#${ch.name}` : 'Chat';
    const item = checkInput({ kind: 'message', ref_id: `chat-${c.channelId}`.slice(0, 40), title: `Chat: ${w.rest}`.slice(0, 160), note: `You set this in ${where}`, due_at: w.at.toISOString(), source: 'message' });
    const [id] = await addReminders(c.env, me, [item]);
    return note(c.env, me, c.channelId, c.threadId, { type: 'note', kind: 'reminder', rid: id, text: w.rest, at: w.at.toISOString(), status: 'waiting' });
  }
  let channelId = c.channelId;
  let body = `Reminder: ${w.rest}`;
  if (target.startsWith('#')) {
    const key = target.slice(1);
    const r = await c.env.DB.prepare(`SELECT id FROM chat_channels WHERE (id = ? OR name = ?) AND archived = 0 AND kind IN ('public', 'private')`).bind(key, lower(key)).first<{ id: string }>();
    if (!r) return tip(c.env, me, c.channelId, c.threadId, `There is no channel called #${key}.`);
    await store.postableChannel(c.env, r.id, me);
    channelId = r.id;
  } else if (target.startsWith('@')) {
    const who = target.slice(1);
    if (!(await c.env.DB.prepare('SELECT 1 AS ok FROM hub_users WHERE lower(email) = ? AND blocked = 0').bind(who).first())) return tip(c.env, me, c.channelId, c.threadId, 'That person is not in FavorOS.');
    channelId = (await store.openConversation(c.env, me, [who])).id;
    body = `<@${who}> Reminder: ${w.rest}`;
  }
  return queue(c, { channelId, threadId: channelId === c.channelId ? c.threadId : null, body, kind: 'remind', at: w.at });
}

async function schedule(c: SlashCtx, rest: string): Promise<store.MessageOut> {
  const me = lower(c.user.email);
  const w = readWhen(rest, c.now || new Date());
  if (!w || !w.rest) return tip(c.env, me, c.channelId, c.threadId, 'Type /schedule monday 8am and the message. It posts then, as you. Times are Eastern.');
  return queue(c, { channelId: c.channelId, threadId: c.threadId, body: w.rest, kind: 'send', at: w.at, keepWords: true });
}

async function queue(c: SlashCtx, q: { channelId: string; threadId: number | null; body: string; kind: 'send' | 'remind'; at: Date; keepWords?: boolean }): Promise<store.MessageOut> {
  const me = lower(c.user.email);
  if (q.at.getTime() > Date.now() + 400 * 86400000) throw new HttpError(400, 'too_far', 'Pick a time within the next year.');
  const waiting = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_scheduled WHERE email = ? AND status = 'waiting'`).bind(me).first<{ n: number }>();
  if ((waiting?.n || 0) >= 100) throw new HttpError(400, 'too_many', 'You have 100 messages waiting. Cancel some with /scheduled first.');
  const id = newId('csch');
  const body = String(q.body).slice(0, 8000);
  await c.env.DB.prepare(`INSERT INTO chat_scheduled (id, email, channel_id, thread_id, body, kind, send_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`)
    .bind(id, me, q.channelId, q.threadId, body, q.kind, q.at.toISOString(), nowIso())
    .run();
  const ch = await store.getChannel(c.env, q.channelId);
  const where = ch && (ch.kind === 'public' || ch.kind === 'private') ? `#${ch.name}` : q.channelId === c.channelId ? 'here' : 'a direct message';
  const msg = await note(c.env, me, c.channelId, c.threadId, { type: 'note', kind: q.kind === 'send' ? 'scheduled' : 'remind', sid: id, text: plainLine(body, (e) => e.split('@')[0], 200), where, at: q.at.toISOString(), status: 'waiting' });
  await c.env.DB.prepare('UPDATE chat_scheduled SET note_id = ? WHERE id = ?').bind(msg.id, id).run();
  return msg;
}

/* ------------------------------------------------------------------------------------------------ checklists */

async function checklist(c: SlashCtx, rest: string): Promise<store.MessageOut> {
  const me = lower(c.user.email);
  const lines = rest.split(/\n|;/).map((s) => s.replace(/^\s*(?:[-*•]|\[\s?\]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  let title = 'Checklist';
  if (lines.length) {
    const t = /^([^:]{1,80}):\s*(.*)$/.exec(lines[0]);
    if (t && !/<@|https?$/.test(t[1])) {
      title = t[1].trim();
      if (t[2].trim()) lines[0] = t[2].trim();
      else lines.shift();
    }
  }
  if (!lines.length) return tip(c.env, me, c.channelId, c.threadId, 'Type /todo Event prep: book the venue @Grace fri; print programs; call the church. Each line becomes a task in Projects.');
  if (lines.length > 20) throw new HttpError(400, 'too_long', 'A checklist holds up to 20 lines.');
  if (!modeAllows(await projectsMode(c.env), { admin: c.user.role === 'admin' }) || !(await projectsReady(c.env))) return tip(c.env, me, c.channelId, c.threadId, 'Checklists save as Projects tasks, and Projects is not open to you yet.');
  const actor = { email: me, name: c.user.name || me, admin: c.user.role === 'admin' };
  const project = await projectOfChannel(c.env, c.channelId);
  const ids: string[] = [];
  const { fire } = await import('../projects/hooks');
  for (const line of lines) {
    const p = (await parseSlash(c.env, '/task ' + line, new Set())) || { title: line, owner: null, due: null, project: null };
    const made = await createTask(c.env, actor, {
      title: (p.title || line).slice(0, 200),
      project_id: project?.id,
      owner_email: p.owner || me,
      due_date: p.due || undefined,
      description: `From the checklist "${title}" in Chat.`,
    });
    ids.push(made.task.id);
    if (!made.existing) await fire(c.env, { kind: 'task.created', actor: me, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'chat' }, told: made.told }).catch(() => undefined);
  }
  const posted = await store.post(c.env, { channel_id: c.channelId, email: me, body: '', thread_id: c.threadId, attachments: [{ type: 'checklist', title, ids }] });
  await c.env.DB.batch(ids.map((t, i) => c.env.DB.prepare('INSERT OR IGNORE INTO chat_checklist_items (message_id, task_id, pos) VALUES (?, ?, ?)').bind(posted.message.id, t, i)));
  return live(c.env, posted.message, 'message');
}

/** Ticks or unticks one line. Anyone in the conversation may; the task records who did it. */
export async function checkItem(env: PlusEnv, user: HubUser, messageId: number, input: { task_id?: unknown; done?: unknown }): Promise<store.MessageOut> {
  const me = lower(user.email);
  const row = await store.getMessage(env, messageId);
  if (!row || row.deleted_at || !store.canSee(row, me)) throw new HttpError(404, 'not_found', 'That checklist is gone.');
  await store.postableChannel(env, row.channel_id, me);
  const tid = String(input.task_id || '');
  if (!(await env.DB.prepare('SELECT 1 AS ok FROM chat_checklist_items WHERE message_id = ? AND task_id = ?').bind(messageId, tid).first())) throw new HttpError(404, 'not_found', 'That line is not on this checklist.');
  const actor = { email: me, name: user.name || me, admin: true };
  const r = await patchTask(env, actor, tid, { done: input.done === true });
  if (r.changed.length) {
    const { fire } = await import('../projects/hooks');
    const kind = r.kinds.includes('done') ? 'task.done' : r.kinds.includes('reopened') ? 'task.reopened' : 'task.updated';
    await fire(env, { kind, actor: me, actorName: actor.name, task: r.task, project: r.project, detail: { fields: r.changed, before: r.before, from: 'chat' }, told: r.told }).catch(() => undefined);
  }
  return live(env, (await store.getMessage(env, messageId))!, 'edit');
}

/** Adds a line to a checklist already posted. */
export async function addItem(env: PlusEnv, user: HubUser, messageId: number, input: { text?: unknown }): Promise<store.MessageOut> {
  const me = lower(user.email);
  const row = await store.getMessage(env, messageId);
  if (!row || row.deleted_at || !store.canSee(row, me)) throw new HttpError(404, 'not_found', 'That checklist is gone.');
  await store.postableChannel(env, row.channel_id, me);
  const atts = JSON.parse(row.attachments || '[]') as store.Attachment[];
  const cl = atts.find((a) => a.type === 'checklist');
  if (!cl) throw new HttpError(400, 'not_checklist', 'That message is not a checklist.');
  const ids = (cl.ids as string[]) || [];
  if (ids.length >= 30) throw new HttpError(400, 'too_long', 'A checklist holds up to 30 lines.');
  const text = String(input.text || '').trim();
  if (!text) throw new HttpError(400, 'empty', 'Write the line first.');
  const p = (await parseSlash(env, '/task ' + text, new Set())) || { title: text, owner: null, due: null, project: null };
  const project = await projectOfChannel(env, row.channel_id);
  const actor = { email: me, name: user.name || me, admin: user.role === 'admin' };
  const made = await createTask(env, actor, { title: (p.title || text).slice(0, 200), project_id: project?.id, owner_email: p.owner || me, due_date: p.due || undefined, description: `From the checklist "${cl.title || 'Checklist'}" in Chat.` });
  const { fire } = await import('../projects/hooks');
  if (!made.existing) await fire(env, { kind: 'task.created', actor: me, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'chat' }, told: made.told }).catch(() => undefined);
  cl.ids = [...ids, made.task.id];
  await env.DB.batch([
    env.DB.prepare('UPDATE chat_messages SET attachments = ? WHERE id = ?').bind(JSON.stringify(atts), messageId),
    env.DB.prepare('INSERT OR IGNORE INTO chat_checklist_items (message_id, task_id, pos) VALUES (?, ?, ?)').bind(messageId, made.task.id, ids.length),
  ]);
  return live(env, (await store.getMessage(env, messageId))!, 'edit');
}

/** After a task changes in Projects, every checklist holding it redraws. */
export async function refreshChecklists(env: PlusEnv, taskId: string): Promise<void> {
  if (!env.CHAT_ROOM) return;
  const rows = (await env.DB.prepare('SELECT message_id FROM chat_checklist_items WHERE task_id = ? ORDER BY message_id DESC LIMIT 8').bind(taskId).all<{ message_id: number }>().catch(() => ({ results: [] as Array<{ message_id: number }> }))).results || [];
  for (const r of rows) {
    const row = await store.getMessage(env, r.message_id);
    if (row && !row.deleted_at) await live(env, row, 'edit').catch(() => undefined);
  }
}

/* ------------------------------------------------------------------------------------------------ polls */

async function poll(c: SlashCtx, rest: string): Promise<store.MessageOut> {
  const me = lower(c.user.email);
  let s = rest;
  const multi = /^multi\b/i.test(s);
  if (multi) s = s.replace(/^multi\b\s*/i, '');
  let parts = s.split(/\s*\|\s*|\n/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0].includes('?')) {
    const [q, opts] = [parts[0].slice(0, parts[0].indexOf('?') + 1), parts[0].slice(parts[0].indexOf('?') + 1)];
    parts = [q, ...opts.split(/\s*,\s*|\s+or\s+/i).map((x) => x.trim()).filter(Boolean)];
  }
  if (parts.length < 3) return tip(c.env, me, c.channelId, c.threadId, 'Type /poll Which day for the staff lunch? | Tuesday | Wednesday | Thursday. Add multi after /poll to allow more than one pick.');
  const q = parts[0].slice(0, 300);
  const opts = [...new Set(parts.slice(1).map((o) => o.slice(0, 120)))].slice(0, 10);
  const posted = await store.post(c.env, { channel_id: c.channelId, email: me, body: '', thread_id: c.threadId, attachments: [{ type: 'poll', q, opts, multi, by: me }] });
  const atts = [{ type: 'poll', q, opts, multi, by: me, mid: posted.message.id }];
  const row = await store.patch(c.env, posted.message.id, { attachments: atts });
  return live(c.env, row, 'message');
}

export async function vote(env: PlusEnv, user: HubUser, messageId: number, input: { choice?: unknown; close?: unknown }): Promise<store.MessageOut> {
  const me = lower(user.email);
  const row = await store.getMessage(env, messageId);
  if (!row || row.deleted_at || !store.canSee(row, me)) throw new HttpError(404, 'not_found', 'That poll is gone.');
  await store.readableChannel(env, row.channel_id, me);
  const atts = JSON.parse(row.attachments || '[]') as store.Attachment[];
  const p = atts.find((a) => a.type === 'poll');
  if (!p) throw new HttpError(400, 'not_poll', 'That message is not a poll.');
  if (input.close === true) {
    if (lower(row.email) !== me) throw new HttpError(403, 'forbidden', 'Only the person who asked can close the poll.');
    p.closed = true;
    const r = await store.patch(env, messageId, { attachments: atts });
    return live(env, r, 'edit');
  }
  if (p.closed) throw new HttpError(400, 'closed', 'This poll is closed.');
  const choice = Number(input.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= ((p.opts as unknown[]) || []).length) throw new HttpError(400, 'bad_choice', 'Pick one of the choices.');
  const had = await env.DB.prepare('SELECT 1 AS ok FROM chat_poll_votes WHERE message_id = ? AND email = ? AND choice = ?').bind(messageId, me, choice).first();
  const stmts = [];
  if (had) stmts.push(env.DB.prepare('DELETE FROM chat_poll_votes WHERE message_id = ? AND email = ? AND choice = ?').bind(messageId, me, choice));
  else {
    if (!p.multi) stmts.push(env.DB.prepare('DELETE FROM chat_poll_votes WHERE message_id = ? AND email = ?').bind(messageId, me));
    stmts.push(env.DB.prepare('INSERT INTO chat_poll_votes (message_id, email, choice, created_at) VALUES (?, ?, ?, ?)').bind(messageId, me, choice, nowIso()));
  }
  await env.DB.batch(stmts);
  return live(env, row, 'edit');
}

/* ------------------------------------------------------------------------------------------------ meetings */

async function meet(c: SlashCtx, rest: string): Promise<store.MessageOut> {
  const me = lower(c.user.email);
  const w = readWhen(rest, c.now || new Date());
  if (!w) return tip(c.env, me, c.channelId, c.threadId, 'Type /meet tomorrow 10am Budget review. Everyone in this conversation is invited and the notes come back here. For a call right now, use /huddle.');
  const ch = await store.postableChannel(c.env, c.channelId, me);
  const members = (await store.membersOf(c.env, ch.id)).filter((m) => m !== me).slice(0, 60);
  const people = members.length ? ((await c.env.DB.prepare(`SELECT lower(email) AS email, name FROM hub_users WHERE lower(email) IN (${members.map(() => '?').join(',')})`).bind(...members).all<{ email: string; name: string }>()).results || []) : [];
  const title = w.rest || (ch.kind === 'public' || ch.kind === 'private' ? `#${ch.name} meeting` : 'Meeting');
  const input = { title: title.slice(0, 140), startsAt: w.at.toISOString(), durationMin: 30, access: 'invited', invitees: people.map((p) => ({ email: p.email, name: p.name })), agenda: `Booked from Chat (${ch.kind === 'public' || ch.kind === 'private' ? '#' + ch.name : 'a direct message'}).` };
  let made: { meeting: { id: string } };
  let onCalendar = true;
  try {
    made = (await createMeeting(c.env as unknown as MeetEnv, { email: me, name: c.user.name }, input, c.origin)) as { meeting: { id: string } };
  } catch (err) {
    // Google refused the calendar event (a test account, or no calendar access): book the room without it.
    if (err instanceof HttpError && err.status < 500 && !/calendar|google/i.test(err.message)) throw err;
    made = (await createMeeting(c.env as unknown as MeetEnv, { email: me, name: c.user.name }, { ...input, calendar: false }, c.origin)) as { meeting: { id: string } };
    onCalendar = false;
  }
  const mid = made.meeting.id;
  const posted = await store.post(c.env, { channel_id: ch.id, email: me, body: `Booked ${title} for ${whenLabel(w.at)}${onCalendar ? '' : ' (not on Google Calendar)'}.`, thread_id: c.threadId, attachments: [{ type: 'meeting', id: mid }] });
  await c.env.DB.prepare('INSERT OR REPLACE INTO chat_meetings (meeting_id, channel_id, message_id, started_by, notes_posted) VALUES (?, ?, ?, ?, 0)').bind(mid, ch.id, posted.message.id, me).run();
  return live(c.env, posted.message, 'message');
}

/* ------------------------------------------------------------------------------------------------ status and out of office */

export interface StatusOut { text: string; away: boolean; until: string | null }

async function status(c: SlashCtx, cmd: string, rest: string): Promise<store.MessageOut> {
  const me = lower(c.user.email);
  const now = c.now || new Date();
  if (cmd === 'back') {
    await c.env.DB.prepare('DELETE FROM chat_status WHERE email = ?').bind(me).run();
    return tip(c.env, me, c.channelId, c.threadId, 'Your status is cleared.');
  }
  let text = rest;
  let until: string | null = null;
  const u = /(?:^|\s)until\s+([\s\S]+)$/i.exec(text);
  if (u) {
    const w = readWhen(u[1], now);
    if (w) {
      until = w.at.toISOString();
      text = (text.slice(0, u.index) + ' ' + w.rest).trim();
    }
  }
  if (cmd === 'status' && !text) return tip(c.env, me, c.channelId, c.threadId, 'Type /status In Uganda until friday, or /away until monday for out of office. /back clears it.');
  await setStatus(c.env, me, { text: text.slice(0, 100) || (cmd === 'away' ? 'Out of office' : ''), away: cmd === 'away', until });
  await publishStatus(c.env, me);
  return tip(c.env, me, c.channelId, c.threadId, `Status set: ${text || 'Out of office'}${until ? `, until ${whenLabel(until)}` : ''}.${cmd === 'away' ? ' A direct message to you gets a note that you are away.' : ''}`);
}

export async function setStatus(env: Env, me: string, s: StatusOut): Promise<void> {
  if (!s.text && !s.away) {
    await env.DB.prepare('DELETE FROM chat_status WHERE email = ?').bind(me).run();
    return;
  }
  await env.DB.prepare('INSERT OR REPLACE INTO chat_status (email, text, away, until, updated_at) VALUES (?, ?, ?, ?, ?)').bind(me, s.text, s.away ? 1 : 0, s.until, nowIso()).run();
}

async function publishStatus(env: PlusEnv, me: string): Promise<void> {
  if (!env.CHAT_ROOM) return;
  const all = await statusMap(env);
  const ppl = ((await env.DB.prepare('SELECT DISTINCT email FROM chat_members WHERE channel_id IN (SELECT channel_id FROM chat_members WHERE email = ?)').bind(me).all<{ email: string }>()).results || []).map((r) => r.email);
  await publish(env as LiveEnv, ppl, { type: 'status', user_id: me, status: all[me] || null }).catch(() => undefined);
}

/** Everyone's status that has not run out, for boot. */
export async function statusMap(env: Env, now = new Date()): Promise<Record<string, StatusOut>> {
  const r = await env.DB.prepare('SELECT email, text, away, until FROM chat_status WHERE until IS NULL OR until > ?').bind(now.toISOString()).all<{ email: string; text: string; away: number; until: string | null }>().catch(() => ({ results: [] as Array<{ email: string; text: string; away: number; until: string | null }> }));
  const out: Record<string, StatusOut> = {};
  for (const x of r.results || []) out[x.email] = { text: x.text, away: !!x.away, until: x.until };
  return out;
}

/** After a direct message, a person who is away gets a private note shown to the writer. Never throws. */
export async function awayNote(env: PlusEnv, row: store.MessageRow, channel: { kind: string }, members: string[]): Promise<store.MessageOut | null> {
  try {
    if (channel.kind !== 'dm' || row.visible_to || row.thread_id) return null;
    const me = lower(row.email);
    const other = members.find((m) => m !== me);
    if (!other) return null;
    const s = (await statusMap(env))[other];
    if (!s || !s.away) return null;
    // Once a day per conversation is enough.
    const said = await env.DB.prepare(`SELECT 1 AS ok FROM chat_messages WHERE channel_id = ? AND visible_to = ? AND attachments LIKE '%"kind":"away"%' AND created_at > ?`).bind(row.channel_id, me, new Date(Date.now() - 20 * 3600000).toISOString()).first();
    if (said) return null;
    const name = await nameOf(env, other);
    return note(env, me, row.channel_id, null, { type: 'note', kind: 'away', text: `${name} is out of office${s.until ? ` until ${whenLabel(s.until)}` : ''}${s.text && s.text !== 'Out of office' ? `: ${s.text}` : ''}. Your message is delivered.` });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------ scheduled: list, cancel, send */

interface SchedRow { id: string; email: string; channel_id: string; thread_id: number | null; body: string; kind: string; send_at: string; status: string; note_id: number | null }

async function waitingList(env: Env, me: string) {
  const r = await env.DB.prepare(`SELECT s.*, c.name AS cname, c.kind AS ckind FROM chat_scheduled s LEFT JOIN chat_channels c ON c.id = s.channel_id WHERE s.email = ? AND s.status = 'waiting' ORDER BY s.send_at LIMIT 50`).bind(me).all<SchedRow & { cname: string; ckind: string }>();
  return (r.results || []).map((x) => ({ sid: x.id, kind: x.kind, text: plainLine(x.body, (e) => e.split('@')[0], 140), where: x.ckind === 'public' || x.ckind === 'private' ? `#${x.cname}` : 'a direct message', channel_id: x.channel_id, at: x.send_at, at_label: whenLabel(x.send_at) }));
}

export async function listScheduled(env: Env, user: HubUser) {
  return waitingList(env, lower(user.email));
}

export async function cancelScheduled(env: PlusEnv, user: HubUser, id: string): Promise<{ ok: true }> {
  const me = lower(user.email);
  const r = await env.DB.prepare(`UPDATE chat_scheduled SET status = 'canceled' WHERE id = ? AND email = ? AND status = 'waiting'`).bind(id, me).run();
  if (!r.meta?.changes) throw new HttpError(404, 'not_found', 'That message already went out or was canceled.');
  await renote(env, id);
  return { ok: true };
}

async function renote(env: PlusEnv, id: string): Promise<void> {
  const s = await env.DB.prepare('SELECT note_id FROM chat_scheduled WHERE id = ?').bind(id).first<{ note_id: number | null }>();
  if (!s?.note_id) return;
  const row = await store.getMessage(env, s.note_id);
  if (row && !row.deleted_at) await live(env, row, 'edit').catch(() => undefined);
}

/** Schedules a message from the message box's Schedule menu (the same as /schedule). */
export async function scheduleFromBox(env: PlusEnv, user: HubUser, channelId: string, input: { body?: unknown; send_at?: unknown; thread_id?: unknown }, origin: string): Promise<store.MessageOut> {
  const at = new Date(String(input.send_at || ''));
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 30000) throw new HttpError(400, 'bad_when', 'Pick a time later than now.');
  const body = String(input.body || '').trim();
  if (!body) throw new HttpError(400, 'empty', 'Write a message first.');
  const me = lower(user.email);
  await store.postableChannel(env, channelId, me);
  return queue({ env, user, channelId, text: '', threadId: Number(input.thread_id) || null, origin }, { channelId, threadId: Number(input.thread_id) || null, body, kind: 'send', at });
}

/** Posts every waiting message whose time has come, as its writer. Returns how many went out. */
export async function runScheduled(env: PlusEnv, now = new Date(), fetcher: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (!(await plusReady(env))) return out;
  const due = (await env.DB.prepare(`SELECT * FROM chat_scheduled WHERE status = 'waiting' AND send_at <= ? ORDER BY send_at LIMIT 40`).bind(now.toISOString()).all<SchedRow>()).results || [];
  for (const s of due) {
    // Claim it first so two passes at the same moment post it once.
    const claim = await env.DB.prepare(`UPDATE chat_scheduled SET status = 'sending' WHERE id = ? AND status = 'waiting'`).bind(s.id).run();
    if (!claim.meta?.changes) continue;
    try {
      const blocked = await env.DB.prepare('SELECT blocked FROM hub_users WHERE lower(email) = ?').bind(s.email).first<{ blocked: number }>();
      if (!blocked || blocked.blocked) throw new HttpError(403, 'gone', 'The writer no longer has FavorOS.');
      const posted = await store.post(env, { channel_id: s.channel_id, email: s.email, body: s.body, thread_id: s.thread_id });
      await live(env, posted.message, 'message');
      await pushForPost(env as PushEnv, { notify: posted.notify, channel: posted.channel, senderName: await nameOf(env, s.email), text: s.body, messageId: posted.message.id, threadId: s.thread_id }, fetcher).catch(() => 0);
      await env.DB.prepare(`UPDATE chat_scheduled SET status = 'sent', message_id = ?, sent_at = ? WHERE id = ?`).bind(posted.message.id, nowIso(), s.id).run();
      out.sent++;
    } catch (err) {
      await env.DB.prepare(`UPDATE chat_scheduled SET status = 'failed', error = ? WHERE id = ?`).bind(String((err as Error)?.message || err).slice(0, 200), s.id).run();
      out.failed++;
    }
    await renote(env, s.id);
  }
  return out;
}

/** Cheap check for page loads: is anything due? */
export async function anyDue(env: Env, now = new Date()): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT 1 AS ok FROM chat_scheduled WHERE status = 'waiting' AND send_at <= ? LIMIT 1`).bind(now.toISOString()).first().catch(() => null);
  return !!r;
}

