// Field staff: people on an allowed partner domain (Favour Africa first) whom an admin approved. Their role is 'field'.
// They get Chat, Meetings and Favor Brain (manuals and programs only), and nothing else: no partner records, no KPI dashboard,
// no Work Center, no mail, no Drive. Three layers hold that line, so one forgotten check cannot open a door:
//   1. the middleware lets a field person reach only the paths listed here (fieldMayOpen),
//   2. the Chat and Meetings routers narrow what they return (fieldChatGuard, meetings in meetroute.ts),
//   3. the Brain proxy sends only a question, marked with the field scope, and only when an admin turned that on (fieldBrainOn).
import { HttpError, type Env } from './http';
import type { HubUser } from './session';

/** Pages a field person may open. Everything else sends them to Chat. */
const PAGES = [/^\/m(\/|$)/, /^\/chat(\/|$)/, /^\/meet(\/|$)/, /^\/brain\/?$/, /^\/help(\/|$)/, /^\/login(\/|$)/, /^\/welcome\/?$/];

/** APIs a field person may call. The routers behind them narrow further. */
const APIS = [/^\/api\/auth\//, /^\/api\/chat\//, /^\/api\/meet\//, /^\/api\/brain\//, /^\/api\/push\//, /^\/api\/phone\//, /^\/api\/hub\/nav\/?$/, /^\/api\/work\/gate\/?$/];

export function fieldMayOpen(path: string): boolean {
  if (path.startsWith('/api/')) return APIS.some((r) => r.test(path));
  return PAGES.some((r) => r.test(path));
}

export async function fieldBrainOn(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM hub_settings WHERE key = 'field.brain' LIMIT 1`).first<{ value: string }>();
    return !!row && row.value === 'on';
  } catch {
    return false;
  }
}

const NOPE = () => new HttpError(403, 'forbidden', 'That is not part of the field staff app.');

/**
 * What a field person may touch in Chat. Public channels are not open to them by default: a channel, a thread or a message is
 * theirs only when they are a member of its conversation, so US team talk about partners never reaches them by browsing or by
 * counting message numbers. Drive, clips and requests are not theirs.
 */
export async function fieldChatGuard(env: Env, user: Pick<HubUser, 'role' | 'email'>, method: string, path: string[]): Promise<void> {
  if (user.role !== 'field') return;
  const me = user.email.toLowerCase();
  const [a, b, c] = path;
  const member = async (channelId: string | undefined): Promise<boolean> => {
    if (!channelId) return false;
    const r = await env.DB.prepare('SELECT 1 AS ok FROM chat_members WHERE channel_id = ? AND email = ?').bind(channelId, me).first();
    return !!r;
  };
  const viaMessage = async (id: string | undefined): Promise<void> => {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) return;
    const row = await env.DB.prepare('SELECT channel_id FROM chat_messages WHERE id = ?').bind(n).first<{ channel_id: string }>();
    if (row && !(await member(row.channel_id))) throw new HttpError(403, 'forbidden', 'You are not in that conversation.');
  };
  if (a === 'drive' || a === 'clips') throw NOPE();
  if (a === 'channels') {
    if (!b) return;
    if (b === 'browse' || c === 'join' || c === 'request') throw NOPE();
    if (!(await member(b))) throw new HttpError(403, 'forbidden', 'You are not in that conversation.');
    return;
  }
  if (a === 'messages' || a === 'threads') return viaMessage(b);
  if (a === 'drive-file') return viaMessage(b);
}

/** Meetings routes a field person may call (method and the part after the meeting id). */
export function fieldMeetRoute(method: string, parts: string[]): boolean {
  const [, id, sub] = parts;
  if (parts[0] !== 'meetings') return false;
  if (!id) return method === 'GET' || method === 'POST';
  if (id === 'directory') return method === 'GET';
  if (!/^[0-9a-f]{24}$/.test(id)) return false;
  if (!sub) return method === 'GET';
  return ['join', 'sync', 'event', 'leave', 'tracks', 'sfu', 'update', 'notes', 'media'].includes(sub);
}
