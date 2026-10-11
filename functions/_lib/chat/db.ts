// Favor Chat's data layer. Every function takes the D1 binding and the signed-in person's email; access rules live here
// (private channels, direct messages and groups answer only their members), so a route cannot forget them.
import { HttpError, nowIso, type Env } from '../http';
import { BRAIN_ID, MEETINGS_ID, SYSTEM_VOICES, channelSlug, cleanBody, dmKey, likePattern, parseMentions } from './text';

export type ChatEnv = Pick<Env, 'DB'>;
export type Kind = 'public' | 'private' | 'dm' | 'group';

export interface ChannelRow {
  id: string;
  kind: Kind;
  name: string;
  topic: string;
  created_by: string;
  created_at: string;
  archived: number;
  last_at: string | null;
}

export interface Attachment {
  type: string;
  [k: string]: unknown;
}

export interface MessageRow {
  id: number;
  channel_id: string;
  thread_id: number | null;
  email: string;
  body: string;
  attachments: string;
  brain: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
}

export interface Reaction {
  emoji: string;
  users: string[];
}

export interface MessageOut {
  id: number;
  channel_id: string;
  thread_id: number | null;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  reactions: Reaction[];
  attachments: Attachment[];
  brain: unknown | null;
  reply_count: number;
  last_reply_at: string | null;
  reply_users: string[];
}

export const DEFAULT_CHANNELS = ['ch_general', 'ch_hub_feedback'];
const PAGE = 60;

const lower = (e: string) => String(e || '').trim().toLowerCase();
const id12 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ channels */

export async function getChannel(env: ChatEnv, id: string): Promise<ChannelRow | null> {
  return env.DB.prepare('SELECT id, kind, name, topic, created_by, created_at, archived, last_at FROM chat_channels WHERE id = ? AND archived = 0').bind(id).first<ChannelRow>();
}

export async function membersOf(env: ChatEnv, channelId: string): Promise<string[]> {
  const r = await env.DB.prepare('SELECT email FROM chat_members WHERE channel_id = ? ORDER BY joined_at, email').bind(channelId).all<{ email: string }>();
  return (r.results || []).map((x) => x.email);
}

export async function isMember(env: ChatEnv, channelId: string, email: string): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 AS ok FROM chat_members WHERE channel_id = ? AND email = ?').bind(channelId, lower(email)).first();
  return !!r;
}

/** The channel when this person may read it: a public channel for anyone, a private one, direct message or group for its members. */
export async function readableChannel(env: ChatEnv, channelId: string, email: string): Promise<ChannelRow> {
  const ch = await getChannel(env, String(channelId || ''));
  if (!ch) throw new HttpError(404, 'not_found', 'That conversation is gone.');
  if (ch.kind === 'public') return ch;
  if (!(await isMember(env, ch.id, email))) throw new HttpError(403, 'forbidden', 'You are not in that conversation.');
  return ch;
}

/** The channel when this person may post in it: a member of any kind. */
export async function postableChannel(env: ChatEnv, channelId: string, email: string): Promise<ChannelRow> {
  const ch = await getChannel(env, String(channelId || ''));
  if (!ch) throw new HttpError(404, 'not_found', 'That conversation is gone.');
  if (!(await isMember(env, ch.id, email))) throw new HttpError(403, 'forbidden', 'Join the channel to post in it.');
  return ch;
}

/** Everyone who signs in as an admin joins the default channels the first time they open Chat. */
export async function joinDefaults(env: ChatEnv, email: string): Promise<void> {
  const now = nowIso();
  await env.DB.batch(DEFAULT_CHANNELS.map((c) => env.DB.prepare('INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, ?, ?)').bind(c, lower(email), 'member', now)));
}

export interface ChannelOut {
  id: string;
  kind: Kind;
  name: string;
  topic: string;
  members: string[];
  created_by: string;
  created_at: string;
  last_at: string | null;
  muted: boolean;
  unread: number;
  mentions: number;
  last_read: number;
  joined: boolean;
}

/** The sidebar: every conversation this person is in, with unread counts and who is in each. */
export async function listChannels(env: ChatEnv, email: string): Promise<ChannelOut[]> {
  const me = lower(email);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.kind, c.name, c.topic, c.created_by, c.created_at, c.last_at, m.muted AS muted, COALESCE(r.last_read_id, 0) AS last_read,
            (SELECT COUNT(*) FROM chat_messages x WHERE x.channel_id = c.id AND x.thread_id IS NULL AND x.deleted_at IS NULL AND x.email != ? AND x.id > COALESCE(r.last_read_id, 0)) AS unread,
            (SELECT COUNT(*) FROM chat_mentions n WHERE n.channel_id = c.id AND n.email = ? AND n.read_at IS NULL) AS mentions
       FROM chat_members m
       JOIN chat_channels c ON c.id = m.channel_id AND c.archived = 0
       LEFT JOIN chat_reads r ON r.channel_id = c.id AND r.email = m.email
      WHERE m.email = ?
      ORDER BY c.kind, c.name`
  ).bind(me, me, me).all<{ id: string; kind: Kind; name: string; topic: string; created_by: string; created_at: string; last_at: string | null; muted: number; last_read: number; unread: number; mentions: number }>();
  const list = rows.results || [];
  if (!list.length) return [];
  const mem = await env.DB.prepare(`SELECT channel_id, email FROM chat_members WHERE channel_id IN (${list.map(() => '?').join(',')}) ORDER BY joined_at, email`).bind(...list.map((c) => c.id)).all<{ channel_id: string; email: string }>();
  const by = new Map<string, string[]>();
  for (const m of mem.results || []) (by.get(m.channel_id) || by.set(m.channel_id, []).get(m.channel_id)!).push(m.email);
  return list.map((c) => ({ ...c, members: by.get(c.id) || [], muted: !!c.muted, joined: true }));
}

export async function createChannel(env: ChatEnv, email: string, input: { name: unknown; topic?: unknown; private?: unknown }): Promise<ChannelOut> {
  const name = channelSlug(input.name);
  if (!name) throw new HttpError(400, 'name', 'Give the channel a name.');
  const taken = await env.DB.prepare(`SELECT 1 AS ok FROM chat_channels WHERE name = ? AND kind IN ('public', 'private')`).bind(name).first();
  if (taken) throw new HttpError(409, 'name_taken', `There is already a channel named ${name}.`);
  const id = 'ch_' + id12();
  const now = nowIso();
  const kind: Kind = input.private === true ? 'private' : 'public';
  const topic = String(input.topic || '').trim().slice(0, 200);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO chat_channels (id, kind, name, topic, created_by, created_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, kind, name, topic, lower(email), now, now),
    env.DB.prepare(`INSERT INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)`).bind(id, lower(email), now),
  ]);
  return { id, kind, name, topic, members: [lower(email)], created_by: lower(email), created_at: now, last_at: now, muted: false, unread: 0, mentions: 0, last_read: 0, joined: true };
}

/** A direct message (one other person, or yourself) or a group (two or more others). The same people always land in the same conversation. */
export async function openConversation(env: ChatEnv, email: string, others: string[]): Promise<ChannelOut> {
  const me = lower(email);
  const people = [...new Set([me, ...others.map(lower)])].filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
  if (people.length > 9) throw new HttpError(400, 'too_many', 'A group holds up to nine people.');
  const key = dmKey(people);
  const kind: Kind = people.length > 2 ? 'group' : 'dm';
  let ch = await env.DB.prepare('SELECT id, kind, name, topic, created_by, created_at, last_at FROM chat_channels WHERE dm_key = ?').bind(key).first<ChannelRow>();
  const now = nowIso();
  if (!ch) {
    const id = 'dm_' + id12();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO chat_channels (id, kind, name, topic, dm_key, created_by, created_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, kind, '', '', key, me, now, now),
      ...people.map((p) => env.DB.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`).bind(id, p, now)),
    ]);
    ch = { id, kind, name: '', topic: '', created_by: me, created_at: now, archived: 0, last_at: now };
  }
  const list = await listChannels(env, me);
  return list.find((c) => c.id === ch!.id) || { id: ch.id, kind: ch.kind, name: '', topic: '', members: people, created_by: me, created_at: ch.created_at, last_at: ch.last_at, muted: false, unread: 0, mentions: 0, last_read: 0, joined: true };
}

export async function browseChannels(env: ChatEnv): Promise<Array<{ id: string; name: string; topic: string; member_count: number }>> {
  const r = await env.DB.prepare(
    `SELECT c.id, c.name, c.topic, (SELECT COUNT(*) FROM chat_members m WHERE m.channel_id = c.id) AS member_count
       FROM chat_channels c WHERE c.kind = 'public' AND c.archived = 0 ORDER BY c.name`
  ).all<{ id: string; name: string; topic: string; member_count: number }>();
  return r.results || [];
}

export async function joinChannel(env: ChatEnv, email: string, channelId: string): Promise<ChannelOut> {
  const ch = await getChannel(env, channelId);
  if (!ch || ch.kind !== 'public') throw new HttpError(404, 'not_found', 'That channel is gone.');
  await env.DB.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`).bind(ch.id, lower(email), nowIso()).run();
  const found = (await listChannels(env, email)).find((c) => c.id === ch.id);
  if (!found) throw new HttpError(500, 'join', 'Could not join the channel.');
  return found;
}

export async function leaveChannel(env: ChatEnv, email: string, channelId: string): Promise<void> {
  const ch = await getChannel(env, channelId);
  if (!ch) return;
  if (ch.kind === 'dm') throw new HttpError(400, 'dm', 'A direct message stays. Mute it instead.');
  await env.DB.prepare('DELETE FROM chat_members WHERE channel_id = ? AND email = ?').bind(ch.id, lower(email)).run();
}

export async function addMembers(env: ChatEnv, actor: string, channelId: string, emails: string[]): Promise<ChannelOut> {
  const ch = await postableChannel(env, channelId, actor);
  if (ch.kind === 'dm') throw new HttpError(400, 'dm', 'Start a group to add people to a conversation.');
  const now = nowIso();
  const add = [...new Set(emails.map(lower))].filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)).slice(0, 50);
  if (add.length) await env.DB.batch(add.map((e) => env.DB.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`).bind(ch.id, e, now)));
  const found = (await listChannels(env, actor)).find((c) => c.id === ch.id);
  if (!found) throw new HttpError(500, 'members', 'Could not add people.');
  return found;
}

export async function setTopic(env: ChatEnv, actor: string, channelId: string, topic: unknown): Promise<string> {
  const ch = await postableChannel(env, channelId, actor);
  if (ch.kind === 'dm' || ch.kind === 'group') throw new HttpError(400, 'topic', 'Conversations have no topic.');
  const t = String(topic || '').trim().slice(0, 200);
  await env.DB.prepare('UPDATE chat_channels SET topic = ? WHERE id = ?').bind(t, ch.id).run();
  return t;
}

export async function setMuted(env: ChatEnv, email: string, channelId: string, muted: boolean): Promise<void> {
  await env.DB.prepare('UPDATE chat_members SET muted = ? WHERE channel_id = ? AND email = ?').bind(muted ? 1 : 0, channelId, lower(email)).run();
}

/* ------------------------------------------------------------------ messages */

async function reactionsFor(env: ChatEnv, ids: number[]): Promise<Map<number, Reaction[]>> {
  const out = new Map<number, Reaction[]>();
  if (!ids.length) return out;
  const r = await env.DB.prepare(`SELECT message_id, emoji, email FROM chat_reactions WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).bind(...ids).all<{ message_id: number; emoji: string; email: string }>();
  for (const x of r.results || []) {
    const list = out.get(x.message_id) || out.set(x.message_id, []).get(x.message_id)!;
    const e = list.find((y) => y.emoji === x.emoji);
    if (e) e.users.push(x.email);
    else list.push({ emoji: x.emoji, users: [x.email] });
  }
  return out;
}

async function replyUsers(env: ChatEnv, rootIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!rootIds.length) return out;
  const r = await env.DB.prepare(`SELECT thread_id, email FROM chat_messages WHERE thread_id IN (${rootIds.map(() => '?').join(',')}) AND deleted_at IS NULL ORDER BY id DESC`).bind(...rootIds).all<{ thread_id: number; email: string }>();
  for (const x of r.results || []) {
    const list = out.get(x.thread_id) || out.set(x.thread_id, []).get(x.thread_id)!;
    if (!list.includes(x.email) && list.length < 3) list.push(x.email);
  }
  return out;
}

/** Rows as the client reads them. `hydrate` fills in clip and meeting cards from their own tables. */
export async function shape(env: ChatEnv, rows: MessageRow[], hydrate?: (a: Attachment[]) => Promise<Attachment[]>): Promise<MessageOut[]> {
  const ids = rows.map((r) => r.id);
  const [rx, ru] = await Promise.all([reactionsFor(env, ids), replyUsers(env, rows.filter((r) => r.reply_count > 0).map((r) => r.id))]);
  const out: MessageOut[] = [];
  for (const r of rows) {
    const deleted = !!r.deleted_at;
    let att = deleted ? [] : parseJson<Attachment[]>(r.attachments, []);
    if (att.length && hydrate) att = await hydrate(att);
    out.push({
      id: r.id,
      channel_id: r.channel_id,
      thread_id: r.thread_id,
      user_id: r.email,
      body: deleted ? '' : r.body,
      created_at: r.created_at,
      edited_at: r.edited_at,
      deleted,
      reactions: deleted ? [] : rx.get(r.id) || [],
      attachments: att,
      brain: deleted ? null : parseJson<unknown>(r.brain, null),
      reply_count: r.reply_count,
      last_reply_at: r.last_reply_at,
      reply_users: ru.get(r.id) || [],
    });
  }
  return out;
}

const COLS = 'id, channel_id, thread_id, email, body, attachments, brain, created_at, edited_at, deleted_at, reply_count, last_reply_at';

export async function getMessage(env: ChatEnv, id: number): Promise<MessageRow | null> {
  return env.DB.prepare(`SELECT ${COLS} FROM chat_messages WHERE id = ?`).bind(id).first<MessageRow>();
}

export async function history(env: ChatEnv, channelId: string, before: number | null, hydrate?: (a: Attachment[]) => Promise<Attachment[]>): Promise<{ messages: MessageOut[]; more: boolean }> {
  const rows = await env.DB.prepare(
    `SELECT ${COLS} FROM chat_messages WHERE channel_id = ? AND thread_id IS NULL ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`
  ).bind(...(before ? [channelId, before, PAGE + 1] : [channelId, PAGE + 1])).all<MessageRow>();
  const list = rows.results || [];
  const more = list.length > PAGE;
  const page = list.slice(0, PAGE).reverse();
  return { messages: await shape(env, page, hydrate), more };
}

export async function thread(env: ChatEnv, rootId: number, hydrate?: (a: Attachment[]) => Promise<Attachment[]>): Promise<{ root: MessageOut; replies: MessageOut[] } | null> {
  const root = await getMessage(env, rootId);
  if (!root || root.thread_id) return null;
  const rows = await env.DB.prepare(`SELECT ${COLS} FROM chat_messages WHERE thread_id = ? ORDER BY id LIMIT 500`).bind(rootId).all<MessageRow>();
  const shaped = await shape(env, [root, ...(rows.results || [])], hydrate);
  return { root: shaped[0], replies: shaped.slice(1) };
}

export interface PostInput {
  channel_id: string;
  email: string;
  body: string;
  thread_id?: number | null;
  attachments?: Attachment[];
  brain?: unknown;
}

export interface Posted {
  message: MessageRow;
  channel: ChannelRow;
  members: string[];
  /** Who gets a bell entry, with why. */
  notify: Array<{ email: string; kind: 'mention' | 'dm' | 'reply' }>;
}

/** Saves a message and works out who it is for. The sender must be a member (the two system voices post anywhere). */
export async function post(env: ChatEnv, input: PostInput): Promise<Posted> {
  const email = lower(input.email);
  const system = SYSTEM_VOICES.has(email);
  const channel = system ? await getChannel(env, input.channel_id) : await postableChannel(env, input.channel_id, email);
  if (!channel) throw new HttpError(404, 'not_found', 'That conversation is gone.');
  const body = cleanBody(input.body);
  const att = (input.attachments || []).slice(0, 6);
  if (!body && !att.length && !input.brain) throw new HttpError(400, 'empty', 'Write a message first.');
  let threadId: number | null = null;
  if (input.thread_id) {
    const root = await getMessage(env, Number(input.thread_id));
    if (!root || root.channel_id !== channel.id || root.thread_id) throw new HttpError(404, 'thread', 'That thread is gone.');
    threadId = root.id;
  }
  const now = nowIso();
  const res = await env.DB.prepare(
    'INSERT INTO chat_messages (channel_id, thread_id, email, body, attachments, brain, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(channel.id, threadId, email, body, JSON.stringify(att), input.brain ? JSON.stringify(input.brain) : null, now).run();
  const id = Number((res.meta as { last_row_id?: number }).last_row_id);
  const stmts = [env.DB.prepare('UPDATE chat_channels SET last_at = ? WHERE id = ?').bind(now, channel.id)];
  if (threadId) stmts.push(env.DB.prepare('UPDATE chat_messages SET reply_count = reply_count + 1, last_reply_at = ? WHERE id = ?').bind(now, threadId));
  await env.DB.batch(stmts);
  const members = await membersOf(env, channel.id);

  // Who is told: people named, everyone for @channel, the other person in a direct message, and (for a reply) the thread's author and the people already in it.
  const want = new Map<string, 'mention' | 'dm' | 'reply'>();
  const mm = parseMentions(body);
  if (channel.kind === 'dm' || channel.kind === 'group') for (const m of members) want.set(m, 'dm');
  if (mm.everyone) for (const m of members) want.set(m, 'mention');
  for (const p of mm.people) if (members.includes(p) || channel.kind === 'public') want.set(p, 'mention');
  if (threadId) {
    const part = await env.DB.prepare('SELECT DISTINCT email FROM chat_messages WHERE (id = ? OR thread_id = ?) AND deleted_at IS NULL').bind(threadId, threadId).all<{ email: string }>();
    for (const p of part.results || []) if (!SYSTEM_VOICES.has(p.email) && !want.has(p.email)) want.set(p.email, 'reply');
  }
  want.delete(email);
  const muted = await env.DB.prepare('SELECT email FROM chat_members WHERE channel_id = ? AND muted = 1').bind(channel.id).all<{ email: string }>();
  const mutedSet = new Set((muted.results || []).map((m) => m.email));
  const notify = [...want.entries()].filter(([e, k]) => (k === 'mention' && mm.people.includes(e)) || !mutedSet.has(e)).map(([e, k]) => ({ email: e, kind: k }));
  if (notify.length) {
    await env.DB.batch(notify.map((n) => env.DB.prepare('INSERT OR IGNORE INTO chat_mentions (message_id, channel_id, email, kind, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, channel.id, n.email, n.kind, now)));
  }
  const message = (await getMessage(env, id))!;
  return { message, channel, members, notify };
}

export async function edit(env: ChatEnv, email: string, id: number, body: unknown): Promise<MessageRow> {
  const m = await getMessage(env, id);
  if (!m || m.deleted_at) throw new HttpError(404, 'not_found', 'That message is gone.');
  if (m.email !== lower(email)) throw new HttpError(403, 'forbidden', 'You can edit your own messages.');
  const text = cleanBody(body);
  if (!text) throw new HttpError(400, 'empty', 'A message cannot be empty. Delete it instead.');
  await env.DB.prepare('UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?').bind(text, nowIso(), id).run();
  return (await getMessage(env, id))!;
}

export async function remove(env: ChatEnv, email: string, id: number): Promise<MessageRow> {
  const m = await getMessage(env, id);
  if (!m || m.deleted_at) throw new HttpError(404, 'not_found', 'That message is gone.');
  if (m.email !== lower(email)) throw new HttpError(403, 'forbidden', 'You can delete your own messages.');
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE chat_messages SET deleted_at = ?, body = '', attachments = '[]', brain = NULL WHERE id = ?`).bind(now, id),
    env.DB.prepare('DELETE FROM chat_mentions WHERE message_id = ?').bind(id),
    env.DB.prepare('DELETE FROM chat_reactions WHERE message_id = ?').bind(id),
  ]);
  return (await getMessage(env, id))!;
}

/** Replace a message's attachments or brain answer (a link card arrives after the post, a Brain answer after its question). */
export async function patch(env: ChatEnv, id: number, fields: { body?: string; attachments?: Attachment[]; brain?: unknown }): Promise<MessageRow> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (fields.body !== undefined) { sets.push('body = ?'); args.push(cleanBody(fields.body)); }
  if (fields.attachments !== undefined) { sets.push('attachments = ?'); args.push(JSON.stringify(fields.attachments.slice(0, 6))); }
  if (fields.brain !== undefined) { sets.push('brain = ?'); args.push(fields.brain ? JSON.stringify(fields.brain) : null); }
  if (sets.length) await env.DB.prepare(`UPDATE chat_messages SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
  return (await getMessage(env, id))!;
}

export async function toggleReaction(env: ChatEnv, email: string, id: number, emoji: string): Promise<Reaction[]> {
  const m = await getMessage(env, id);
  if (!m || m.deleted_at) throw new HttpError(404, 'not_found', 'That message is gone.');
  await readableChannel(env, m.channel_id, email);
  const me = lower(email);
  const has = await env.DB.prepare('SELECT 1 AS ok FROM chat_reactions WHERE message_id = ? AND email = ? AND emoji = ?').bind(id, me, emoji).first();
  if (has) await env.DB.prepare('DELETE FROM chat_reactions WHERE message_id = ? AND email = ? AND emoji = ?').bind(id, me, emoji).run();
  else {
    const n = await env.DB.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM chat_reactions WHERE message_id = ?').bind(id).first<{ n: number }>();
    if ((n?.n || 0) >= 20) throw new HttpError(400, 'reactions', 'That message has as many different reactions as it can hold.');
    await env.DB.prepare('INSERT INTO chat_reactions (message_id, email, emoji, created_at) VALUES (?, ?, ?, ?)').bind(id, me, emoji, nowIso()).run();
  }
  return (await reactionsFor(env, [id])).get(id) || [];
}

/* ------------------------------------------------------------------ reads, bell, search */

export async function markRead(env: ChatEnv, email: string, channelId: string, upTo: number): Promise<void> {
  const me = lower(email);
  const now = nowIso();
  await readableChannel(env, channelId, me);
  const up = Math.max(0, Math.floor(Number(upTo) || 0));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO chat_reads (channel_id, email, last_read_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (channel_id, email) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id), updated_at = excluded.updated_at`
    ).bind(channelId, me, up, now),
    env.DB.prepare('UPDATE chat_mentions SET read_at = ? WHERE channel_id = ? AND email = ? AND read_at IS NULL AND message_id <= ?').bind(now, channelId, me, up),
  ]);
}

/** A thread opened: the replies in it that were addressed to this person are read. */
export async function markThreadRead(env: ChatEnv, email: string, rootId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE chat_mentions SET read_at = ? WHERE email = ? AND read_at IS NULL AND message_id IN (SELECT id FROM chat_messages WHERE id = ? OR thread_id = ?)`
  ).bind(nowIso(), lower(email), rootId, rootId).run();
}

export interface InboxItem {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_kind: Kind;
  thread_id: number | null;
  from: string;
  body: string;
  kind: string;
  at: string;
}

export async function inbox(env: ChatEnv, email: string): Promise<{ count: number; items: InboxItem[] }> {
  const me = lower(email);
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM chat_mentions WHERE email = ? AND read_at IS NULL').bind(me).first<{ n: number }>();
  const rows = await env.DB.prepare(
    `SELECT m.id, m.channel_id, c.name AS channel_name, c.kind AS channel_kind, m.thread_id, m.email AS "from", m.body, n.kind, n.created_at AS at
       FROM chat_mentions n JOIN chat_messages m ON m.id = n.message_id JOIN chat_channels c ON c.id = n.channel_id
      WHERE n.email = ? AND n.read_at IS NULL ORDER BY n.created_at DESC LIMIT 20`
  ).bind(me).all<InboxItem>();
  return { count: c?.n || 0, items: rows.results || [] };
}

export async function clearInbox(env: ChatEnv, email: string, messageId: number | null): Promise<void> {
  const me = lower(email);
  if (messageId) await env.DB.prepare('UPDATE chat_mentions SET read_at = ? WHERE email = ? AND message_id = ? AND read_at IS NULL').bind(nowIso(), me, messageId).run();
  else await env.DB.prepare('UPDATE chat_mentions SET read_at = ? WHERE email = ? AND read_at IS NULL').bind(nowIso(), me).run();
}

export async function unreadMentionCount(env: ChatEnv, email: string): Promise<number> {
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM chat_mentions WHERE email = ? AND read_at IS NULL').bind(lower(email)).first<{ n: number }>();
  return c?.n || 0;
}

export type SearchFilter = 'all' | 'here' | 'files' | 'mine';

/** Messages this person can read that match the words. Private channels and conversations count only when they are in them. */
export async function search(env: ChatEnv, email: string, q: string, opts: { filter?: SearchFilter; channel?: string; limit?: number } = {}): Promise<MessageRow[]> {
  const me = lower(email);
  const text = String(q || '').trim();
  if (text.length < 2) return [];
  const where = [
    'm.deleted_at IS NULL',
    `(c.kind = 'public' OR c.id IN (SELECT channel_id FROM chat_members WHERE email = ?))`,
    'c.archived = 0',
  ];
  const args: unknown[] = [me];
  if (opts.filter === 'here' && opts.channel) { where.push('m.channel_id = ?'); args.push(opts.channel); }
  if (opts.filter === 'files') where.push(`m.attachments != '[]'`);
  if (opts.filter === 'mine') { where.push('m.id IN (SELECT message_id FROM chat_mentions WHERE email = ?)'); args.push(me); }
  where.push(`(LOWER(m.body) LIKE ? ESCAPE '\\' OR LOWER(m.attachments) LIKE ? ESCAPE '\\')`);
  const pat = likePattern(text);
  args.push(pat, pat);
  const r = await env.DB.prepare(
    `SELECT m.id, m.channel_id, m.thread_id, m.email, m.body, m.attachments, m.brain, m.created_at, m.edited_at, m.deleted_at, m.reply_count, m.last_reply_at
       FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`
  ).bind(...args, Math.min(30, opts.limit || 20)).all<MessageRow>();
  return r.results || [];
}

export { BRAIN_ID, MEETINGS_ID };
