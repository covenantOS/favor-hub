// "Since you were away": what changed for one person while they were off for a day or more. The visit table (db/briefing.sql) records
// when Today was last opened; a visit more than four hours after the last one starts a new session and remembers where the old one ended.
import { keepAllowed } from '../access';
import type { Env } from '../http';
import { cacheGet, plural, sig } from './text';

export interface Seen {
  seen_at: string;
  away_from: string | null;
  session_at: string;
  dismissed_at: string | null;
}

const SESSION_GAP = 4 * 3600000;
const AWAY_MIN = 20 * 3600000;

export async function readSeen(env: Pick<Env, 'DB'>, email: string): Promise<Seen | null> {
  return env.DB.prepare('SELECT seen_at, away_from, session_at, dismissed_at FROM brief_seen WHERE email = ?').bind(email.toLowerCase()).first<Seen>().catch(() => null);
}

/** Record that Today was opened. Returns the state after the touch. */
export async function touchSeen(env: Pick<Env, 'DB'>, email: string, now = new Date()): Promise<Seen | null> {
  const me = email.toLowerCase();
  const prev = await readSeen(env, me);
  const iso = now.toISOString();
  if (!prev) {
    await env.DB.prepare('INSERT INTO brief_seen (email, seen_at, away_from, session_at, dismissed_at) VALUES (?, ?, NULL, ?, NULL)').bind(me, iso, iso).run().catch(() => undefined);
    return { seen_at: iso, away_from: null, session_at: iso, dismissed_at: null };
  }
  const gap = now.getTime() - Date.parse(prev.seen_at);
  if (gap > SESSION_GAP) {
    await env.DB.prepare('UPDATE brief_seen SET seen_at = ?, away_from = ?, session_at = ?, dismissed_at = NULL WHERE email = ?').bind(iso, prev.seen_at, iso, me).run().catch(() => undefined);
    return { seen_at: iso, away_from: prev.seen_at, session_at: iso, dismissed_at: null };
  }
  await env.DB.prepare('UPDATE brief_seen SET seen_at = ? WHERE email = ?').bind(iso, me).run().catch(() => undefined);
  return { ...prev, seen_at: iso };
}

export async function dismissAway(env: Pick<Env, 'DB'>, email: string): Promise<void> {
  await env.DB.prepare('UPDATE brief_seen SET dismissed_at = ? WHERE email = ?').bind(new Date().toISOString(), email.toLowerCase()).run().catch(() => undefined);
}

/** True when the person's last visit ended a day or more before this one began and they have not closed the card. */
export function wasAway(s: Seen | null): s is Seen & { away_from: string } {
  if (!s || !s.away_from || s.dismissed_at) return false;
  return Date.parse(s.session_at) - Date.parse(s.away_from) >= AWAY_MIN;
}

export interface AwayPart {
  key: 'partners' | 'requests' | 'projects' | 'chat';
  label: string;
  count: number;
  line: string;
  href: string;
}

export interface Away {
  from: string;
  days: number;
  parts: AwayPart[];
  summary: string;
}

async function one(env: Pick<Env, 'DB'>, sql: string, ...binds: unknown[]): Promise<number> {
  const r = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>().catch(() => null);
  return Number(r?.n) || 0;
}

export interface AwayInput {
  env: Env;
  email: string;
  from: string;
  /** Gift count and total since the visit, read by the caller only when the person may see partners. */
  gifts: { count: number; total: number } | null;
  isAdmin: boolean;
}

export async function awayFor(i: AwayInput): Promise<Away> {
  const { env, from } = i;
  const me = i.email.toLowerCase();
  const days = Math.max(1, Math.round((Date.now() - Date.parse(from)) / 86400000));
  const parts: AwayPart[] = [];
  if (i.gifts && i.gifts.count) parts.push({ key: 'partners', label: 'Partners', count: i.gifts.count, line: `${plural(i.gifts.count, 'new gift')} from your partners, $${Math.round(i.gifts.total).toLocaleString('en-US')} in all`, href: '/work/?view=gifts' });

  const [notices, fresh, submitted] = await Promise.all([
    one(env, 'SELECT COUNT(DISTINCT request_id) AS n FROM request_notices WHERE email = ? AND created_at > ?', me, from),
    i.isAdmin ? one(env, "SELECT COUNT(*) AS n FROM requests WHERE created_at > ? AND status = 'inbox'", from) : Promise.resolve(0),
    one(env, "SELECT COUNT(*) AS n FROM requests WHERE lower(submitter_email) = ? AND completed_at > ? AND status = 'done'", me, from),
  ]);
  const reqCount = notices + fresh + submitted;
  if (reqCount) {
    const bits = [notices ? `${plural(notices, 'request')} with news for you` : '', fresh ? `${plural(fresh, 'new request')} to review` : '', submitted ? `${plural(submitted, 'request')} of yours finished` : ''].filter(Boolean);
    parts.push({ key: 'requests', label: 'Requests', count: reqCount, line: bits.join(', '), href: '/requests/?view=new' });
  }

  const [taskNews, assigned] = await Promise.all([
    one(env, 'SELECT COUNT(*) AS n FROM hub_task_notices WHERE email = ? AND created_at > ?', me, from),
    one(env, "SELECT COUNT(*) AS n FROM hub_tasks WHERE owner_email = ? AND created_at > ? AND status != 'done' AND created_by != ?", me, from, me),
  ]);
  if (taskNews || assigned) {
    parts.push({
      key: 'projects',
      label: 'Projects',
      count: taskNews + assigned,
      line: [assigned ? `${plural(assigned, 'new task')} given to you` : '', taskNews ? `${plural(taskNews, 'update')} on tasks you follow` : ''].filter(Boolean).join(', '),
      href: '/projects/',
    });
  }

  // Chat lines appear only for a person who may use Chat (access groups); their stored messages stay hidden.
  const chatOpen = (await keepAllowed(env, 'chat', [me])).length > 0;
  const [mentions, messages] = chatOpen ? await Promise.all([
    one(env, 'SELECT COUNT(*) AS n FROM chat_mentions WHERE email = ? AND created_at > ?', me, from),
    one(
      env,
      `SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_members cm ON cm.channel_id = m.channel_id AND cm.email = ?1 AND cm.muted = 0
        WHERE m.created_at > ?2 AND m.email != ?1 AND m.deleted_at IS NULL AND (m.visible_to IS NULL OR m.visible_to = ?1)`,
      me,
      from
    ),
  ]) : [0, 0];
  if (messages || mentions) {
    parts.push({ key: 'chat', label: 'Chat', count: messages, line: [messages ? `${plural(messages, 'new message')} in your channels` : '', mentions ? `${plural(mentions, 'mention')} of you` : ''].filter(Boolean).join(', '), href: '/chat/' });
  }

  let summary = '';
  if (parts.length) {
    const key = `away:${me}:${from}`;
    const s = sig(parts.map((p) => [p.key, p.count]));
    const hit = await cacheGet<{ sig: string; text: string }>(env, key, 12 * 3600000);
    if (hit && hit.sig === s) summary = hit.text;
    else {
      summary = '';
    }
  }
  return { from, days, parts, summary };
}
