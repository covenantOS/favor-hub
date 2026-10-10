// Favor Brain chat history: the person's chats, one chat with its turns, rename, pin, delete. The Brain
// writes the turns (favor-mcp chat-store.ts); this file only reads and edits what that person owns.
import type { Env } from '../http';

export const KEEP_DAYS = 30;
export interface ThreadRow { id: string; title: string; pinned: number; made_at: string; changed_at: string }
export interface TurnRow { n: number; question: string; answer_json: string; at: string; ref: string | null }

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
    ? `SELECT id, title, pinned, made_at, changed_at FROM brain_threads WHERE email = ? AND (title LIKE ? ESCAPE '\\' OR id IN (SELECT thread_id FROM brain_turns WHERE question LIKE ? ESCAPE '\\')) ORDER BY pinned DESC, changed_at DESC LIMIT 200`
    : 'SELECT id, title, pinned, made_at, changed_at FROM brain_threads WHERE email = ? ORDER BY pinned DESC, changed_at DESC LIMIT 200';
  const st = term ? env.DB.prepare(sql).bind(email, like(term), like(term)) : env.DB.prepare(sql).bind(email);
  return ((await st.all<ThreadRow>()).results || []).map((r) => ({ ...r, pinned: r.pinned ? 1 : 0 }));
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
