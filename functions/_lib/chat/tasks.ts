// Request board tasks in Favor Chat. One conversation in two places:
//   a card     sending a request to someone, or mentioning them on it, posts a card in the direct message between the two people
//              (title, the note, status, Open). It is a normal Chat message with a {type: 'task'} attachment.
//   a reply    typed under that card in Chat becomes a comment on the request (route.ts calls taskReply after a thread post).
//   a copy     a comment typed on the board lands under the latest card in each direct message its author is part of.
// request_chat_links ties each of these messages to its request. The bell counts request notices, so the Chat mention rows
// these messages would add are removed for the people the board already told.
import type { Env } from '../http';
import * as store from './db';
import { publish, type LiveEnv } from './live';
import { hydrateAttachments } from './hydrate';
import { staffDirectory } from '../people';
import { getRequest } from '../db';
import { addComment } from '../requests/tasks';

export type CardKind = 'sent' | 'mention';
type ChatTaskEnv = Env & Partial<LiveEnv>;

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const STATUS: Record<string, string> = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };

async function link(env: ChatTaskEnv, m: { message_id: number; request_id: string; channel_id: string; root_id: number | null; comment_id: string | null; kind: string }): Promise<void> {
  await env.DB.prepare('INSERT OR REPLACE INTO request_chat_links (message_id, request_id, channel_id, root_id, comment_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(m.message_id, m.request_id, m.channel_id, m.root_id, m.comment_id, m.kind, new Date().toISOString())
    .run();
}

async function quietMentions(env: ChatTaskEnv, messageId: number, emails?: string[]): Promise<void> {
  if (!emails) {
    await env.DB.prepare('DELETE FROM chat_mentions WHERE message_id = ?').bind(messageId).run();
    return;
  }
  for (const e of emails) await env.DB.prepare('DELETE FROM chat_mentions WHERE message_id = ? AND email = ?').bind(messageId, lower(e)).run();
}

async function live(env: ChatTaskEnv, row: store.MessageRow): Promise<void> {
  if (!env.CHAT_ROOM) return;
  const [msg] = await store.shape(env, [row], (x) => hydrateAttachments(env, x));
  await publish(env as LiveEnv, store.audienceOf(row, await store.membersOf(env, row.channel_id)), { type: 'message', message: msg });
}

/** Posts the card in the direct message between the sender and the person told. Returns the message id. */
export async function postCard(env: ChatTaskEnv, input: { from: string; to: string; requestId: string; kind: CardKind; note: string }): Promise<number> {
  const from = lower(input.from);
  const to = lower(input.to);
  const ch = await store.openConversation(env, from, [to]);
  // A mention between two people who already have this request's card in their direct message adds no second card: the
  // comment is copied into that card's thread instead.
  if (input.kind === 'mention') {
    const had = await env.DB.prepare(`SELECT MAX(message_id) AS id FROM request_chat_links WHERE request_id = ? AND channel_id = ? AND kind = 'card'`).bind(input.requestId, ch.id).first<{ id: number | null }>();
    if (had?.id) return had.id;
  }
  const posted = await store.post(env, {
    channel_id: ch.id,
    email: from,
    body: '',
    attachments: [{ type: 'task', id: input.requestId, kind: input.kind, note: String(input.note || '').slice(0, 600) }],
  });
  const id = posted.message.id;
  await link(env, { message_id: id, request_id: input.requestId, channel_id: ch.id, root_id: null, comment_id: null, kind: 'card' });
  await quietMentions(env, id);
  await live(env, posted.message).catch(() => undefined);
  return id;
}

/** Copies a board comment under the latest card in each direct message the author is part of, except the one it came from. */
export async function copyComment(
  env: ChatTaskEnv,
  input: { requestId: string; author: string; commentId: string; body: string; exceptRoot: number | null; allowed: (email: string) => boolean }
): Promise<number[]> {
  const author = lower(input.author);
  const cards = await env.DB.prepare(`SELECT channel_id, MAX(message_id) AS root FROM request_chat_links WHERE request_id = ? AND kind = 'card' GROUP BY channel_id`)
    .bind(input.requestId)
    .all<{ channel_id: string; root: number }>();
  let skipChannel = '';
  if (input.exceptRoot) {
    const from = await env.DB.prepare('SELECT channel_id FROM request_chat_links WHERE message_id = ?').bind(input.exceptRoot).first<{ channel_id: string }>();
    skipChannel = from?.channel_id || '';
  }
  const made: number[] = [];
  for (const c of cards.results || []) {
    if (c.channel_id === skipChannel) continue;
    const members = await store.membersOf(env, c.channel_id);
    if (!members.includes(author)) continue;
    const others = members.filter((m) => m !== author);
    if (!others.some((m) => input.allowed(m))) continue;
    const posted = await store.post(env, { channel_id: c.channel_id, email: author, body: input.body, thread_id: c.root });
    await link(env, { message_id: posted.message.id, request_id: input.requestId, channel_id: c.channel_id, root_id: c.root, comment_id: input.commentId, kind: 'copy' });
    await quietMentions(env, posted.message.id);
    await live(env, posted.message).catch(() => undefined);
    made.push(posted.message.id);
  }
  return made;
}

/** The request a card belongs to, when this message is one. */
export async function cardRequest(env: ChatTaskEnv, messageId: number): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT request_id FROM request_chat_links WHERE message_id = ? AND kind = 'card'`).bind(messageId).first<{ request_id: string }>().catch(() => null);
  return r?.request_id || null;
}

/**
 * Called by Chat after a reply is posted in a thread. A reply under a request's card becomes a comment on the request;
 * anything else is left alone. Never throws: Chat's own post already succeeded.
 */
export async function taskReply(env: ChatTaskEnv, row: store.MessageRow, user: { email: string; name: string; role: string }): Promise<void> {
  try {
    if (!row.thread_id || row.visible_to) return;
    const requestId = await cardRequest(env, row.thread_id);
    if (!requestId) return;
    const req = await getRequest(env, requestId);
    if (!req) return;
    const atts = (() => {
      try {
        return JSON.parse(row.attachments || '[]') as unknown[];
      } catch {
        return [];
      }
    })();
    const body = row.body || (atts.length ? 'Shared an attachment in Chat.' : '');
    if (!body) return;
    const c = await addComment(env, req, { email: lower(row.email), name: user.name || row.email, admin: user.role === 'admin' }, body, { source: 'chat', chatMessageId: row.id, chatRoot: row.thread_id });
    await link(env, { message_id: row.id, request_id: requestId, channel_id: row.channel_id, root_id: row.thread_id, comment_id: c.id, kind: 'reply' });
    if (c.told.length) await quietMentions(env, row.id, c.told);
  } catch (err) {
    console.warn('[chat] task reply', err);
  }
}

/** Called by Chat after a message is deleted: a reply that became a comment is deleted on the request too. */
export async function taskDeleted(env: ChatTaskEnv, messageId: number): Promise<void> {
  try {
    const r = await env.DB.prepare(`SELECT comment_id FROM request_chat_links WHERE message_id = ? AND kind = 'reply'`).bind(messageId).first<{ comment_id: string }>();
    if (!r?.comment_id) return;
    await env.DB.batch([
      env.DB.prepare(`UPDATE request_comments SET deleted_at = ?, body = '' WHERE id = ? AND deleted_at IS NULL`).bind(new Date().toISOString(), r.comment_id),
      env.DB.prepare('DELETE FROM request_notices WHERE comment_id = ? AND read_at IS NULL').bind(r.comment_id),
    ]);
  } catch {
    // Nothing to undo.
  }
}

/** The people a note names, so the card draws each mention as a name without asking again. */
function namesIn(note: string, dir: Map<string, { name: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of note.matchAll(/<@([^>\s]+)>/g)) {
    const id = lower(m[1]);
    out[id] = dir.get(id)?.name || id.split('@')[0];
  }
  return out;
}

/** Fills each task card from the request as it is now: title, status, owner and due date. The note stays as it was sent. */
export async function hydrateTaskCards(env: ChatTaskEnv, list: store.Attachment[]): Promise<store.Attachment[]> {
  const ids = [...new Set(list.filter((a) => a.type === 'task' && typeof a.id === 'string').map((a) => String(a.id)))];
  if (!ids.length) return list;
  const q = ids.map(() => '?').join(',');
  const reqs = await env.DB.prepare(`SELECT id, title, status FROM requests WHERE id IN (${q})`).bind(...ids).all<{ id: string; title: string; status: string }>().catch(() => ({ results: [] as Array<{ id: string; title: string; status: string }> }));
  const tasks = await env.DB.prepare(`SELECT request_id, owner_email, due_date FROM request_tasks WHERE request_id IN (${q})`).bind(...ids).all<{ request_id: string; owner_email: string | null; due_date: string | null }>().catch(() => ({ results: [] as Array<{ request_id: string; owner_email: string | null; due_date: string | null }> }));
  const byReq = new Map((reqs.results || []).map((r) => [r.id, r]));
  const byTask = new Map((tasks.results || []).map((t) => [t.request_id, t]));
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  return list.map((a) => {
    if (a.type !== 'task') return a;
    const r = byReq.get(String(a.id));
    if (!r) return { type: 'link', url: '#', host: 'Request', title: 'This request is no longer on the board' };
    const t = byTask.get(r.id);
    const owner = t?.owner_email ? dir.get(t.owner_email) : null;
    return {
      type: 'task', id: r.id, kind: a.kind === 'mention' ? 'mention' : 'sent', note: String(a.note || ''), names: namesIn(String(a.note || ''), dir), title: r.title, status: r.status, status_label: STATUS[r.status] || r.status,
      owner: owner ? owner.name : t?.owner_email || '', due_date: t?.due_date || '', url: `/requests/?r=${encodeURIComponent(r.id)}`,
    };
  });
}
