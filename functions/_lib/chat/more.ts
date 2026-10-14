// Favor Chat, second round (2026-10-11): the Threads view, the mentions and reactions view, pinned messages and bookmarks,
// "Also send to the channel" for a thread reply, and a confirm card pressed inside a Favor Brain answer.
// Threads and activity read the tables Chat already has. Pins and bookmarks live in two new tables (db/favor-chat2.sql);
// until that file is applied every read here answers empty and every write answers "not ready", and the page hides the controls.
import { HttpError, nowIso } from '../http';
import * as store from './db';
import { BRAIN_ID, plainLine } from './text';

type Env = store.ChatEnv;
const lower = (e: unknown) => String(e || '').trim().toLowerCase();
const id12 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const marksQ = (n: number) => Array.from({ length: n }, () => '?').join(',');

const COLS = 'id, channel_id, thread_id, email, body, attachments, brain, created_at, edited_at, deleted_at, reply_count, last_reply_at, visible_to';
const MINE = '(SELECT channel_id FROM chat_members WHERE email = ?)';

/* ------------------------------------------------------------------ threads */

export interface ThreadItem {
  root: store.MessageOut;
  channel_id: string;
  /** The newest replies, oldest first (two at most). */
  latest: store.MessageOut[];
  unread: number;
  last_reply_at: string | null;
}

/**
 * Every thread this person is in: one they started, replied in, or were told about (named in it, or it is in a direct message
 * of theirs), in a conversation they are still a member of. Newest activity first, with unread replies counted per thread.
 */
export async function threadsFor(env: Env, email: string, hydrate?: (a: store.Attachment[], channelId?: string) => Promise<store.Attachment[]>): Promise<{ threads: ThreadItem[]; unread: number }> {
  const me = lower(email);
  const roots = await env.DB.prepare(
    `SELECT ${COLS.split(', ').map((c) => 'r.' + c).join(', ')} FROM chat_messages r JOIN chat_channels c ON c.id = r.channel_id AND c.archived = 0
      WHERE r.thread_id IS NULL AND r.reply_count > 0 AND r.visible_to IS NULL AND r.channel_id IN ${MINE}
        AND (r.email = ?
          OR r.id IN (SELECT thread_id FROM chat_messages WHERE email = ? AND thread_id IS NOT NULL AND deleted_at IS NULL)
          OR r.id IN (SELECT x.thread_id FROM chat_mentions n JOIN chat_messages x ON x.id = n.message_id WHERE n.email = ? AND x.thread_id IS NOT NULL))
      ORDER BY r.last_reply_at DESC LIMIT 40`
  ).bind(me, me, me, me).all<store.MessageRow>();
  const list = roots.results || [];
  if (!list.length) return { threads: [], unread: await threadUnreadTotal(env, me) };
  const ids = list.map((r) => r.id);
  const [unread, replies] = await Promise.all([
    store.threadUnread(env, me, ids),
    env.DB.prepare(`SELECT ${COLS} FROM chat_messages WHERE thread_id IN (${marksQ(ids.length)}) AND deleted_at IS NULL AND visible_to IS NULL ORDER BY id DESC LIMIT 400`).bind(...ids).all<store.MessageRow>(),
  ]);
  const last = new Map<number, store.MessageRow[]>();
  for (const r of replies.results || []) {
    const l = last.get(r.thread_id as number) || last.set(r.thread_id as number, []).get(r.thread_id as number)!;
    if (l.length < 2) l.push(r);
  }
  const flat: store.MessageRow[] = [];
  for (const r of list) { flat.push(r); for (const x of (last.get(r.id) || []).slice().reverse()) flat.push(x); }
  const shaped = await store.shape(env, flat, hydrate);
  const byId = new Map(shaped.map((m) => [m.id, m]));
  const threads = list.map((r) => ({
    root: byId.get(r.id)!,
    channel_id: r.channel_id,
    latest: (last.get(r.id) || []).slice().reverse().map((x) => byId.get(x.id)!).filter(Boolean),
    unread: unread.get(r.id) || 0,
    last_reply_at: r.last_reply_at,
  }));
  return { threads, unread: await threadUnreadTotal(env, me) };
}

/** Unread replies across every thread: the number beside Threads in the list. */
export async function threadUnreadTotal(env: Env, email: string): Promise<number> {
  const me = lower(email);
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM chat_mentions n JOIN chat_messages x ON x.id = n.message_id
      WHERE n.email = ? AND n.read_at IS NULL AND x.thread_id IS NOT NULL AND x.deleted_at IS NULL AND (x.visible_to IS NULL OR x.visible_to = ?) AND x.channel_id IN ${MINE}`
  ).bind(me, me, me).first<{ n: number }>();
  return r?.n || 0;
}

/* ------------------------------------------------------------------ mentions and reactions */

export interface ActivityItem {
  kind: 'mention' | 'reply' | 'reaction';
  at: string;
  by: string;
  emoji?: string;
  unread?: boolean;
  channel_id: string;
  message: store.MessageOut;
}

/** Where this person was named, replies in their threads, and reactions other people left on their messages. Newest first. */
export async function activityFor(env: Env, email: string): Promise<ActivityItem[]> {
  const me = lower(email);
  const [men, rx] = await Promise.all([
    env.DB.prepare(
      `SELECT n.message_id, n.kind, n.created_at AS at, n.read_at FROM chat_mentions n JOIN chat_messages m ON m.id = n.message_id
        WHERE n.email = ? AND n.kind IN ('mention', 'reply') AND m.deleted_at IS NULL AND (m.visible_to IS NULL OR m.visible_to = ?) AND m.channel_id IN ${MINE}
        ORDER BY n.created_at DESC LIMIT 40`
    ).bind(me, me, me).all<{ message_id: number; kind: 'mention' | 'reply'; at: string; read_at: string | null }>(),
    env.DB.prepare(
      `SELECT x.message_id, x.emoji, x.email AS by, x.created_at AS at FROM chat_reactions x JOIN chat_messages m ON m.id = x.message_id
        WHERE m.email = ? AND x.email != ? AND m.deleted_at IS NULL AND m.channel_id IN ${MINE} ORDER BY x.created_at DESC LIMIT 40`
    ).bind(me, me, me).all<{ message_id: number; emoji: string; by: string; at: string }>(),
  ]);
  const ids = [...new Set([...(men.results || []), ...(rx.results || [])].map((x) => x.message_id))];
  if (!ids.length) return [];
  const rows = await env.DB.prepare(`SELECT ${COLS} FROM chat_messages WHERE id IN (${marksQ(ids.length)})`).bind(...ids).all<store.MessageRow>();
  const shaped = new Map((await store.shape(env, rows.results || [])).map((m) => [m.id, m]));
  const out: ActivityItem[] = [];
  for (const n of men.results || []) {
    const m = shaped.get(n.message_id);
    if (m) out.push({ kind: n.kind, at: n.at, by: m.user_id, unread: !n.read_at, channel_id: m.channel_id, message: m });
  }
  for (const r of rx.results || []) {
    const m = shaped.get(r.message_id);
    if (m) out.push({ kind: 'reaction', at: r.at, by: r.by, emoji: r.emoji, channel_id: m.channel_id, message: m });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 60);
}

/* ------------------------------------------------------------------ pins and bookmarks */

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  added_by: string;
  added_at: string;
}
const MAX_PINS = 50;
const MAX_BOOKMARKS = 12;
const notReady = () => new HttpError(503, 'not_ready', 'Pins and bookmarks are not switched on yet.');
const missing = (err: unknown) => /no such table/i.test(String((err as Error)?.message || err));

/** True once db/favor-chat2.sql is applied. */
export async function pinsReady(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT message_id FROM chat_pins LIMIT 1').first();
    await env.DB.prepare('SELECT id FROM chat_bookmarks LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

/** Pin counts and bookmarks for a set of conversations (the bar under each channel name). Empty when the tables are absent. */
export async function barsFor(env: Env, channelIds: string[]): Promise<{ ready: boolean; pins: Map<string, number>; bookmarks: Map<string, Bookmark[]> }> {
  const pins = new Map<string, number>();
  const bookmarks = new Map<string, Bookmark[]>();
  if (!channelIds.length) return { ready: await pinsReady(env), pins, bookmarks };
  try {
    const q = marksQ(channelIds.length);
    const [p, b] = await Promise.all([
      env.DB.prepare(`SELECT p.channel_id, COUNT(*) AS n FROM chat_pins p JOIN chat_messages m ON m.id = p.message_id AND m.deleted_at IS NULL WHERE p.channel_id IN (${q}) GROUP BY p.channel_id`).bind(...channelIds).all<{ channel_id: string; n: number }>(),
      env.DB.prepare(`SELECT id, channel_id, title, url, added_by, added_at FROM chat_bookmarks WHERE channel_id IN (${q}) ORDER BY added_at`).bind(...channelIds).all<Bookmark & { channel_id: string }>(),
    ]);
    for (const x of p.results || []) pins.set(x.channel_id, x.n);
    for (const x of b.results || []) (bookmarks.get(x.channel_id) || bookmarks.set(x.channel_id, []).get(x.channel_id)!).push({ id: x.id, title: x.title, url: x.url, added_by: x.added_by, added_at: x.added_at });
    return { ready: true, pins, bookmarks };
  } catch (err) {
    if (!missing(err)) throw err;
    return { ready: false, pins, bookmarks };
  }
}

export async function pinsOf(env: Env, email: string, channelId: string, hydrate?: (a: store.Attachment[], channelId?: string) => Promise<store.Attachment[]>): Promise<{ pins: Array<store.MessageOut & { pinned_by: string; pinned_at: string }>; bookmarks: Bookmark[] }> {
  await store.readableChannel(env, channelId, email);
  try {
    const p = await env.DB.prepare(
      `SELECT ${COLS.split(', ').map((c) => 'm.' + c).join(', ')}, p.pinned_by, p.pinned_at FROM chat_pins p JOIN chat_messages m ON m.id = p.message_id
        WHERE p.channel_id = ? AND m.deleted_at IS NULL AND m.visible_to IS NULL ORDER BY p.pinned_at DESC LIMIT ${MAX_PINS}`
    ).bind(channelId).all<store.MessageRow & { pinned_by: string; pinned_at: string }>();
    const rows = p.results || [];
    const shaped = await store.shape(env, rows, hydrate);
    const bars = await barsFor(env, [channelId]);
    return { pins: shaped.map((m, i) => ({ ...m, pinned: true, pinned_by: rows[i].pinned_by, pinned_at: rows[i].pinned_at })), bookmarks: bars.bookmarks.get(channelId) || [] };
  } catch (err) {
    if (!missing(err)) throw err;
    return { pins: [], bookmarks: [] };
  }
}

/** Pin or unpin a message. Any member of the conversation may; a private Brain answer cannot be pinned. */
export async function setPin(env: Env, email: string, messageId: number, on: boolean): Promise<{ channel_id: string; pins: number }> {
  const me = lower(email);
  const m = await store.getMessage(env, messageId);
  if (!m || m.deleted_at || m.visible_to) throw new HttpError(404, 'not_found', 'That message is gone.');
  await store.postableChannel(env, m.channel_id, me);
  try {
    if (on) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM chat_pins WHERE channel_id = ?').bind(m.channel_id).first<{ n: number }>();
      if ((n?.n || 0) >= MAX_PINS) throw new HttpError(400, 'pins_full', `A conversation holds up to ${MAX_PINS} pinned messages. Unpin one first.`);
      await env.DB.prepare('INSERT OR IGNORE INTO chat_pins (message_id, channel_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)').bind(m.id, m.channel_id, me, nowIso()).run();
    } else await env.DB.prepare('DELETE FROM chat_pins WHERE message_id = ?').bind(m.id).run();
    const bars = await barsFor(env, [m.channel_id]);
    return { channel_id: m.channel_id, pins: bars.pins.get(m.channel_id) || 0 };
  } catch (err) {
    if (missing(err)) throw notReady();
    throw err;
  }
}

/** A bookmark's address: a web page, or a page on this site. */
export function cleanUrl(raw: unknown): string {
  const s = String(raw || '').trim().slice(0, 600);
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
}

export async function addBookmark(env: Env, email: string, channelId: string, input: { title?: unknown; url?: unknown }): Promise<Bookmark[]> {
  const me = lower(email);
  await store.postableChannel(env, channelId, me);
  const url = cleanUrl(input.url);
  if (!url) throw new HttpError(400, 'url', 'Paste a web address that starts with https://.');
  let title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!title) title = url.startsWith('/') ? url : new URL(url).hostname.replace(/^www\./, '');
  try {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM chat_bookmarks WHERE channel_id = ?').bind(channelId).first<{ n: number }>();
    if ((n?.n || 0) >= MAX_BOOKMARKS) throw new HttpError(400, 'bookmarks_full', `A conversation holds up to ${MAX_BOOKMARKS} bookmarks. Remove one first.`);
    await env.DB.prepare('INSERT INTO chat_bookmarks (id, channel_id, title, url, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)').bind('bm_' + id12(), channelId, title, url, me, nowIso()).run();
    return (await barsFor(env, [channelId])).bookmarks.get(channelId) || [];
  } catch (err) {
    if (missing(err)) throw notReady();
    throw err;
  }
}

export async function removeBookmark(env: Env, email: string, channelId: string, id: string): Promise<Bookmark[]> {
  await store.postableChannel(env, channelId, lower(email));
  try {
    await env.DB.prepare('DELETE FROM chat_bookmarks WHERE id = ? AND channel_id = ?').bind(id, channelId).run();
    return (await barsFor(env, [channelId])).bookmarks.get(channelId) || [];
  } catch (err) {
    if (missing(err)) throw notReady();
    throw err;
  }
}

/* ------------------------------------------------------------------ a reply also sent to the channel */

/** The thread a message really belongs to: a channel copy of a reply ("also sent to the channel") points at the original thread. */
export function threadRootOf(row: Pick<store.MessageRow, 'id' | 'attachments'>): number {
  const ref = attachmentsOf(row).find((a) => a.type === 'threadref');
  return ref && Number(ref.root) > 0 ? Number(ref.root) : row.id;
}
export function attachmentsOf(row: Pick<store.MessageRow, 'attachments'>): store.Attachment[] {
  try {
    const a = JSON.parse(row.attachments || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
/** The other half of a reply that was also sent to the channel: the copy's id for the reply, the reply's id for the copy. */
export function twinOf(row: Pick<store.MessageRow, 'attachments'>): number | null {
  for (const a of attachmentsOf(row)) {
    if (a.type === 'threadref' && Number(a.reply) > 0) return Number(a.reply);
    if (a.type === 'sent' && Number(a.copy) > 0) return Number(a.copy);
  }
  return null;
}

/**
 * Posts the channel copy of a thread reply and ties the two together. The copy carries a line that says which thread it
 * answers; people already told about the reply are not told a second time.
 */
export async function alsoSend(env: Env, reply: store.MessageRow, names: (id: string) => string): Promise<{ copy: store.Posted; reply: store.MessageRow } | null> {
  if (!reply.thread_id || reply.visible_to) return null;
  const root = await store.getMessage(env, reply.thread_id);
  if (!root) return null;
  const mine = attachmentsOf(reply).filter((a) => a.type !== 'sent');
  const excerpt = root.deleted_at ? '' : plainLine(root.body, names, 90) || (attachmentsOf(root).length ? 'an attachment' : root.email === BRAIN_ID ? 'an answer from Favor Brain' : '');
  const copy = await store.post(env, {
    channel_id: reply.channel_id,
    email: reply.email,
    body: reply.body,
    attachments: [...mine.slice(0, 5), { type: 'threadref', root: root.id, reply: reply.id, by: root.email, text: excerpt }],
  });
  await env.DB.prepare('DELETE FROM chat_mentions WHERE message_id = ? AND email IN (SELECT email FROM chat_mentions WHERE message_id = ?)').bind(copy.message.id, reply.id).run();
  const linked = await store.patch(env, reply.id, { attachments: [...mine.slice(0, 5), { type: 'sent', copy: copy.message.id }] });
  return { copy, reply: linked };
}

/* ------------------------------------------------------------------ a confirm card inside a Brain answer */

export interface BrainStored {
  status?: string;
  blocks?: Array<Record<string, unknown>>;
  follow?: string[];
  [k: string]: unknown;
}

/** The confirm card at this place in a Brain answer the person can read, or an error the route returns as is. */
export async function confirmCard(env: Env, email: string, messageId: number, index: number): Promise<{ row: store.MessageRow; brain: BrainStored; block: Record<string, unknown> }> {
  const row = await store.getMessage(env, messageId);
  if (!row || row.deleted_at || row.email !== BRAIN_ID || !store.canSee(row, email)) throw new HttpError(404, 'not_found', 'That message is gone.');
  await store.readableChannel(env, row.channel_id, email);
  let brain: BrainStored | null = null;
  try {
    brain = JSON.parse(row.brain || 'null');
  } catch {
    brain = null;
  }
  const block = brain && Array.isArray(brain.blocks) ? brain.blocks[index] : null;
  if (!brain || !block || block.type !== 'confirm' || !block.id) throw new HttpError(400, 'no_card', 'That card is no longer there.');
  return { row, brain, block };
}
