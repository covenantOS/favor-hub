// Favor Brain chat history: the person's chats, one chat with its turns, rename, pin, delete. The Brain
// writes the turns (favor-mcp chat-store.ts); this file only reads and edits what that person owns.
import type { Env } from '../http';

export const KEEP_DAYS = 30;
export interface ThreadRow { id: string; title: string; pinned: number; made_at: string; changed_at: string; pending?: number }
export interface TurnRow { n: number; question: string; answer_json: string; at: string; ref: string | null }

/** A turn the server is still answering is stored as {"pending":1,...} until the answer lands. */
export const PENDING_LIKE = '{"pending":1%';
/** A pending turn older than this was lost with its job; it reads as an error so nobody waits forever. */
export const PENDING_MAX_MS = 4 * 60 * 1000;
const PENDING_SQL = `EXISTS (SELECT 1 FROM brain_turns t WHERE t.thread_id = brain_threads.id AND t.answer_json LIKE '{"pending":1%' AND t.at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'))`;

const like = (q: string) => '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

/** Chats whose last turn is older than 30 days go, with their turns. */
export async function purgeOld(env: Env, now = Date.now()): Promise<void> {
  const cutoff = new Date(now - KEEP_DAYS * 864e5).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM brain_turns WHERE thread_id IN (SELECT id FROM brain_threads WHERE changed_at < ?)').bind(cutoff),
    env.DB.prepare('DELETE FROM brain_threads WHERE changed_at < ?').bind(cutoff),
  ]);
}

export async function listThreads(env: Env, email: string, q = ''): Promise<ThreadRow[]> {
  const term = q.trim().slice(0, 80);
  const sql = term
    ? `SELECT id, title, pinned, made_at, changed_at, ${PENDING_SQL} AS pending FROM brain_threads WHERE email = ? AND (title LIKE ? ESCAPE '\\' OR id IN (SELECT thread_id FROM brain_turns WHERE question LIKE ? ESCAPE '\\')) ORDER BY pinned DESC, changed_at DESC LIMIT 200`
    : `SELECT id, title, pinned, made_at, changed_at, ${PENDING_SQL} AS pending FROM brain_threads WHERE email = ? ORDER BY pinned DESC, changed_at DESC LIMIT 200`;
  const st = term ? env.DB.prepare(sql).bind(email, like(term), like(term)) : env.DB.prepare(sql).bind(email);
  return ((await st.all<ThreadRow>()).results || []).map((r) => ({ ...r, pinned: r.pinned ? 1 : 0, pending: r.pending ? 1 : 0 }));
}

export async function getThread(env: Env, email: string, id: string) {
  const th = await env.DB.prepare('SELECT id, title, pinned, made_at, changed_at FROM brain_threads WHERE id = ? AND email = ?').bind(id, email).first<ThreadRow>();
  if (!th) return null;
  const turns = ((await env.DB.prepare('SELECT n, question, answer_json, at, ref FROM brain_turns WHERE thread_id = ? ORDER BY n').bind(id).all<TurnRow>()).results || []).map((t) => {
    let answer: unknown = null;
    try {
      answer = JSON.parse(t.answer_json);
    } catch {
      // a turn that cannot be read shows as an empty answer
    }
    const a = answer as { pending?: number } | null;
    if (a && a.pending && Date.now() - new Date(t.at).getTime() > PENDING_MAX_MS) answer = { error: 'This answer did not finish. Ask again.' };
    return { n: t.n, question: t.question, answer, at: t.at, ref: t.ref };
  });
  return { thread: { ...th, pinned: th.pinned ? 1 : 0 }, turns };
}

export async function patchThread(env: Env, email: string, id: string, p: { title?: unknown; pinned?: unknown }): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof p.title === 'string' && p.title.trim()) {
    sets.push('title = ?');
    args.push(p.title.trim().slice(0, 80));
  }
  if (typeof p.pinned === 'boolean') {
    sets.push('pinned = ?');
    args.push(p.pinned ? 1 : 0);
  }
  if (!sets.length) return false;
  const r = await env.DB.prepare(`UPDATE brain_threads SET ${sets.join(', ')} WHERE id = ? AND email = ?`).bind(...args, id, email).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function deleteThread(env: Env, email: string, id: string): Promise<boolean> {
  const own = await env.DB.prepare('SELECT 1 AS ok FROM brain_threads WHERE id = ? AND email = ?').bind(id, email).first();
  if (!own) return false;
  await env.DB.batch([env.DB.prepare('DELETE FROM brain_turns WHERE thread_id = ?').bind(id), env.DB.prepare('DELETE FROM brain_threads WHERE id = ? AND email = ?').bind(id, email)]);
  return true;
}

const CONV = /^c_[a-z0-9]{4,16}$/;
export const newConvId = () => `c_${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8)}`;
export const validConv = (v: unknown): v is string => typeof v === 'string' && CONV.test(v);

/** The same short title the page shows while the chat is new. */
export const titleOf = (q: string) => {
  const t = q.replace(/[?.!]+$/, '');
  return t.length > 44 ? t.slice(0, 42) + '...' : t.charAt(0).toUpperCase() + t.slice(1);
};

/** Saves the question the moment it is sent, as a pending turn, and returns the turn's row id.
 *  Returns null when the chat belongs to someone else or the tables are not there yet. */
export async function startTurn(env: Env, email: string, conv: string, question: string): Promise<{ id: number; n: number } | null> {
  try {
    const now = new Date().toISOString();
    const th = await env.DB.prepare('SELECT email FROM brain_threads WHERE id = ?').bind(conv).first<{ email: string }>();
    if (th && th.email !== email) return null;
    if (!th) await env.DB.prepare('INSERT INTO brain_threads (id, email, title, pinned, made_at, changed_at) VALUES (?, ?, ?, 0, ?, ?)').bind(conv, email, titleOf(question), now, now).run();
    else await env.DB.prepare('UPDATE brain_threads SET changed_at = ? WHERE id = ?').bind(now, conv).run();
    const last = await env.DB.prepare('SELECT COALESCE(MAX(n), 0) AS n FROM brain_turns WHERE thread_id = ?').bind(conv).first<{ n: number }>();
    const n = Number(last?.n || 0) + 1;
    const r = await env.DB.prepare('INSERT INTO brain_turns (thread_id, n, question, answer_json, at, ref) VALUES (?, ?, ?, ?, ?, NULL)').bind(conv, n, question.slice(0, 600), '{"pending":1}', now).run();
    return { id: Number(r.meta?.last_row_id), n };
  } catch {
    return null;
  }
}

/** Puts the finished answer (or the error) on the pending turn and touches the chat. */
export async function finishTurn(env: Env, turnId: number, conv: string, answer: unknown, ref: string | null): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE brain_turns SET answer_json = ?, ref = ?, at = ? WHERE id = ?').bind(JSON.stringify(answer), ref, now, turnId),
    env.DB.prepare('UPDATE brain_threads SET changed_at = ? WHERE id = ?').bind(now, conv),
  ]);
}

/** The Brain files each answer under the chat id it is given; the hub gives it a scratch id and removes that copy. */
export async function dropScratch(env: Env, scratch: string): Promise<void> {
  try {
    await env.DB.batch([env.DB.prepare('DELETE FROM brain_turns WHERE thread_id = ?').bind(scratch), env.DB.prepare('DELETE FROM brain_threads WHERE id = ?').bind(scratch)]);
  } catch {
    // nothing to remove
  }
}
