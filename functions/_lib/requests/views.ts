// Reads over the request board's tasks for the places a request shows up outside the board: whether a person has been told,
// the search palette, and the Favor Brain ("what is waiting on me", "what did I send someone").
import type { Env } from '../http';
import { staffDirectory, type Person } from '../people';
import { noticeGate, type Actor, type TaskRow } from './tasks';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const STATUS: Record<string, string> = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };

/** Mention tokens as words: <@email> becomes @Name from the staff list. */
export function plainMentions(text: string, dir: Map<string, Person>): string {
  return String(text || '').replace(/<@([^>\s]+)>/g, (_all, id: string) => '@' + (dir.get(lower(id))?.name || lower(id).split('@')[0]));
}

export interface Told {
  email: string;
  /** A notice reached them for this (they see it on Today, the bell and in Chat). */
  told: boolean;
  /** Notices can reach them right now. False while request notices are off. */
  open: boolean;
}

/** For the owner and the person waited on: were they told, and could they be told now. */
export async function toldFor(env: Env, requestId: string, task: TaskRow | null): Promise<{ owner: Told | null; waiting: Told | null }> {
  const gate = await noticeGate(env);
  const one = async (email: string | null, kind: string): Promise<Told | null> => {
    if (!email) return null;
    const row = await env.DB.prepare('SELECT 1 AS ok FROM request_notices WHERE request_id = ? AND email = ? AND kind = ? LIMIT 1').bind(requestId, email, kind).first().catch(() => null);
    return { email, told: !!row, open: gate(email) };
  };
  return { owner: await one(task?.owner_email || null, 'sent'), waiting: await one(task?.waiting_on || null, 'waiting') };
}

interface Joined {
  id: string;
  title: string;
  body: string;
  status: string;
  submitter_name: string;
  created_at: string;
  updated_at: string;
  owner_email: string | null;
  sent_by: string | null;
  sent_at: string | null;
  due_date: string | null;
  waiting_on: string | null;
}

async function joined(env: Env, admin: boolean): Promise<Joined[]> {
  const sql = `SELECT q.id, q.title, q.body, q.status, q.submitter_name, q.created_at, q.updated_at, t.owner_email, t.sent_by, t.sent_at, t.due_date, t.waiting_on
                 FROM requests q LEFT JOIN request_tasks t ON t.request_id = q.id ${admin ? '' : "WHERE q.status != 'declined'"} ORDER BY q.updated_at DESC`;
  try {
    return (await env.DB.prepare(sql).all<Joined>()).results || [];
  } catch {
    // Before db/request-tasks.sql: the requests alone.
    const r = await env.DB.prepare(`SELECT id, title, body, status, submitter_name, created_at, updated_at, NULL AS owner_email, NULL AS sent_by, NULL AS sent_at, NULL AS due_date, NULL AS waiting_on FROM requests ${admin ? '' : "WHERE status != 'declined'"} ORDER BY updated_at DESC`).all<Joined>();
    return r.results || [];
  }
}

export interface Hit {
  id: string;
  title: string;
  status: string;
  owner: string;
  waiting_on: string;
  asked_by: string;
  due_date: string;
  url: string;
}

const shape = (r: Joined, dir: Map<string, Person>): Hit => ({
  id: r.id,
  title: r.title,
  status: STATUS[r.status] || r.status,
  owner: r.owner_email ? dir.get(r.owner_email)?.name || r.owner_email : '',
  waiting_on: r.waiting_on ? dir.get(r.waiting_on)?.name || r.waiting_on : '',
  asked_by: r.submitter_name,
  due_date: r.due_date || '',
  url: `/requests/?r=${encodeURIComponent(r.id)}`,
});

/** One request as a search row, or null when it is not on the board for this person (a declined request shows to admins only). */
export async function requestHit(env: Env, actor: Actor, id: string): Promise<Hit | null> {
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const row = (await joined(env, actor.admin)).find((r) => r.id === id);
  return row ? shape(row, dir) : null;
}

/** Requests whose title, text or people match every word typed. Everyone reads the board, so everyone may find a request on it. */
export async function searchRequests(env: Env, actor: Actor, q: string, limit = 8): Promise<Hit[]> {
  const words = lower(q).split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length || words.join('').length < 2) return [];
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const name = (e: string | null) => (e ? dir.get(e)?.name || e : '');
  const rows = await joined(env, actor.admin);
  const scored: Array<{ r: Joined; s: number }> = [];
  for (const r of rows) {
    const title = lower(r.title);
    const people = lower(`${r.submitter_name} ${name(r.owner_email)} ${name(r.waiting_on)} ${name(r.sent_by)}`);
    const body = lower(r.body);
    let s = 0;
    let all = true;
    for (const w of words) {
      if (title.includes(w)) s += 3;
      else if (people.includes(w)) s += 2;
      else if (body.includes(w)) s += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ r, s: s + (r.status === 'done' ? 0 : 0.5) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => shape(x.r, dir));
}

/**
 * What the Favor Brain reads for one person: the open requests they own, what waits on them, what they sent and to whom, what
 * of theirs waits on someone else, and requests that name them with something unread. Open requests only, except sent_by_me,
 * which keeps finished ones for 30 days so "what did I send" has an answer.
 */
export async function brainView(env: Env, email: string, about = '') {
  const me = lower(email);
  const who = lower(about);
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const rows = await joined(env, false);
  const open = (r: Joined) => r.status !== 'done' && r.status !== 'declined';
  const recent = (r: Joined) => open(r) || Date.parse(r.updated_at) > Date.now() - 30 * 86400000;
  // "what did I send someone": a name or part of one narrows sent_by_me to that person.
  const matches = (e: string | null) => !who || (!!e && (e.includes(who) || lower(dir.get(e)?.name).includes(who)));
  const unread = await env.DB.prepare('SELECT DISTINCT request_id FROM request_notices WHERE email = ? AND read_at IS NULL').bind(me).all<{ request_id: string }>().catch(() => ({ results: [] as { request_id: string }[] }));
  const news = new Set((unread.results || []).map((x) => x.request_id));
  // A hand-off this person was never told about stays out of their answers, the same as on Today.
  const heard = await env.DB.prepare('SELECT DISTINCT request_id FROM request_notices WHERE email = ?').bind(me).all<{ request_id: string }>().catch(() => ({ results: [] as { request_id: string }[] }));
  const told = new Set((heard.results || []).map((x) => x.request_id));
  return {
    ok: true,
    for: me,
    as_of: new Date().toISOString(),
    mine: rows.filter((r) => open(r) && r.owner_email === me && told.has(r.id)).map((r) => ({ ...shape(r, dir), sent_by: r.sent_by ? dir.get(r.sent_by)?.name || r.sent_by : '' })),
    waiting_on_me: rows.filter((r) => open(r) && r.waiting_on === me && told.has(r.id)).map((r) => shape(r, dir)),
    sent_by_me: rows.filter((r) => recent(r) && r.sent_by === me && r.owner_email !== me && matches(r.owner_email)).map((r) => ({ ...shape(r, dir), sent_at: r.sent_at || '' })),
    waiting_on_others: rows.filter((r) => open(r) && !!r.waiting_on && r.waiting_on !== me && (r.owner_email === me || r.sent_by === me)).map((r) => shape(r, dir)),
    news: rows.filter((r) => news.has(r.id)).map((r) => shape(r, dir)),
  };
}
