// Sending Chat email. A first email is a welcome (at once, once ever). The 5-minute work drain cron calls run(); everything is decided here from the chat tables, so a message
// posted by any route is covered. Rules:
//   start    a member of a direct message, group or private channel (never its creator, never the sender) gets one email for the
//            first message from someone else after they joined, if they have not read it and have not muted the conversation.
//   unread   a message for you (a chat_mentions row: direct message, group, @mention, thread reply) still unread ten minutes later
//            gets one email per conversation covering what is unread (the last three shown). Then nothing more for that conversation
//            until the person reads it, writes in it, or opens it.
// Nobody is emailed for a muted conversation, when they turned Chat email off, when they read or wrote in the conversation in the
// last ten minutes, or twice for one message (chat_email_sent holds a once-only row per person and message, taken before the send).
// Only messages created after the first run count (chat_email_state since), so there is no backfill.
import { nowIso, type Env } from '../http';
import { effective } from '../admin/settings';
import { isTester } from '../testuser';
import { send } from '../requests/mail';
import { buildChatMail, chatLink, type ChatKind, type ChatMailMessage } from './email';
import { hold, quietNow } from '../quiet';
import { isAdminEmail } from '../session';
import { SYSTEM_VOICES, parseMentions, plainBody } from './text';

const ORIGIN = 'https://dash.favorintl.org';
const WINDOW_MS = 10 * 60 * 1000;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const SHOWN = 3;

export type MailEnv = Pick<Env, 'DB'> & Partial<Env>;

export interface Person {
  name: string;
  picture: string;
}

/* ------------------------------------------------------------------ the person's switch */

export async function chatEmailOn(env: MailEnv, email: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT on_chat FROM chat_email_prefs WHERE email = ?').bind(lower(email)).first<{ on_chat: number }>().catch(() => null);
  return row ? row.on_chat !== 0 : true;
}

const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function setChatEmail(env: MailEnv, email: string, on: boolean): Promise<boolean> {
  await env.DB.prepare(
    'INSERT INTO chat_email_prefs (email, on_chat, token, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET on_chat = excluded.on_chat, updated_at = excluded.updated_at'
  )
    .bind(lower(email), on ? 1 : 0, newToken(), nowIso())
    .run();
  return on;
}

/** The key in this person's footer link. Made the first time it is needed. */
export async function tokenFor(env: MailEnv, email: string): Promise<string> {
  const e = lower(email);
  await env.DB.prepare('INSERT OR IGNORE INTO chat_email_prefs (email, on_chat, token, updated_at) VALUES (?, 1, ?, ?)').bind(e, newToken(), nowIso()).run();
  const row = await env.DB.prepare('SELECT token FROM chat_email_prefs WHERE email = ?').bind(e).first<{ token: string }>();
  return row?.token || '';
}

/** Turns Chat email off for the address that owns this token. Returns the address, or null for a token that matches nobody. */
export async function turnOffWithToken(env: MailEnv, email: string, token: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT email FROM chat_email_prefs WHERE email = ? AND token = ? AND token <> \'\'').bind(lower(email), String(token || '')).first<{ email: string }>();
  if (!row) return null;
  await env.DB.prepare('UPDATE chat_email_prefs SET on_chat = 0, updated_at = ? WHERE email = ?').bind(nowIso(), row.email).run();
  return row.email;
}

export async function offLinkFor(env: MailEnv, email: string, origin = ORIGIN): Promise<string> {
  return `${origin}/chat-email/off?e=${encodeURIComponent(lower(email))}&t=${await tokenFor(env, email)}`;
}

/* ------------------------------------------------------------------ who gets emailed */

interface Candidate {
  email: string;
  channel_id: string;
  kind: 'welcome' | 'start' | 'unread';
  /** The messages this email covers, oldest first. */
  ids: number[];
  /** Welcome only: why the first message is for this person (dm, mention, reply or start). */
  why?: string;
}

interface MsgRow {
  id: number;
  channel_id: string;
  email: string;
  body: string;
  created_at: string;
  thread_id: number | null;
}

async function ready(env: MailEnv): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT 1 FROM chat_email_state LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

/** A real, active person with the Chat email switch on. Blocked and pending accounts, the test users and the system voices never get mail. */
async function eligible(env: MailEnv, email: string): Promise<boolean> {
  if (isTester(email) || SYSTEM_VOICES.has(email)) return false;
  let u: { blocked: number } | null;
  try {
    u = await env.DB.prepare('SELECT blocked FROM hub_users WHERE lower(email) = ? AND blocked = 0 AND COALESCE(pending, 0) = 0').bind(email).first<{ blocked: number }>();
  } catch {
    u = await env.DB.prepare('SELECT blocked FROM hub_users WHERE lower(email) = ? AND blocked = 0').bind(email).first<{ blocked: number }>();
  }
  if (!u) return false;
  return chatEmailOn(env, email);
}

/** Mute, switch, tester and the ten-minute activity window, for one person in one conversation. True when the person may be emailed. */
async function allowed(env: MailEnv, email: string, channelId: string, cutoff: string): Promise<boolean> {
  if (!(await eligible(env, email))) return false;
  const mem = await env.DB.prepare('SELECT muted FROM chat_members WHERE channel_id = ? AND email = ?').bind(channelId, email).first<{ muted: number }>();
  if (mem && mem.muted) return false;
  // Active in the window: opened the conversation (the read pointer moved) or wrote in it.
  const seen = await env.DB.prepare('SELECT updated_at AS at FROM chat_reads WHERE channel_id = ? AND email = ?').bind(channelId, email).first<{ at: string }>();
  if (seen && seen.at >= cutoff) return false;
  const wrote = await env.DB.prepare('SELECT MAX(created_at) AS at FROM chat_messages WHERE channel_id = ? AND email = ?').bind(channelId, email).first<{ at: string | null }>();
  if (wrote?.at && wrote.at >= cutoff) return false;
  return true;
}

/** True when an email already went to this person for this conversation and they have not read or written since. */
async function waitingOnRead(env: MailEnv, email: string, channelId: string): Promise<boolean> {
  const last = await env.DB.prepare(`SELECT MAX(sent_at) AS at FROM chat_email_log WHERE email = ? AND channel_id = ? AND state = 'sent'`).bind(email, channelId).first<{ at: string | null }>();
  if (!last?.at) return false;
  const [reads, wrote, opened] = await Promise.all([
    env.DB.prepare('SELECT updated_at AS at FROM chat_reads WHERE channel_id = ? AND email = ?').bind(channelId, email).first<{ at: string }>(),
    env.DB.prepare('SELECT MAX(created_at) AS at FROM chat_messages WHERE channel_id = ? AND email = ?').bind(channelId, email).first<{ at: string | null }>(),
    env.DB.prepare('SELECT MAX(read_at) AS at FROM chat_mentions WHERE channel_id = ? AND email = ?').bind(channelId, email).first<{ at: string | null }>(),
  ]);
  const after = [reads?.at, wrote?.at, opened?.at].filter((x): x is string => !!x).sort().pop() || '';
  return after <= last.at;
}

/** A recent failed send for this pair keeps the next few runs from trying again at once. */
async function failedLately(env: MailEnv, email: string, channelId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const r = await env.DB.prepare(`SELECT 1 AS x FROM chat_email_log WHERE email = ? AND channel_id = ? AND state = 'failed' AND sent_at > ? LIMIT 1`).bind(email, channelId, since).first();
  return !!r;
}

/** Everyone who should be emailed right now, and about which messages. Reads only; nothing is written. */
export async function whoGetsEmail(env: MailEnv, since: string, now: Date): Promise<Candidate[]> {
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  const out: Candidate[] = [];
  const taken = new Set<string>();

  // 0. Welcome: the first thing that would notify a person in Chat, sent at once, once ever.
  const lead = new Map<string, { channel_id: string; id: number; why: string }>();
  const note = (email: string, channel_id: string, id: number, why: string) => {
    const have = lead.get(email);
    if (!have || id < have.id) lead.set(email, { channel_id, id, why });
  };
  const events =
    (
      await env.DB.prepare(
        `SELECT n.email, n.channel_id, n.message_id, n.kind FROM chat_mentions n JOIN chat_messages m ON m.id = n.message_id JOIN chat_channels c ON c.id = n.channel_id
          WHERE n.created_at > ? AND m.deleted_at IS NULL AND c.archived = 0 AND m.email NOT IN ('brain', 'meetings', 'gifts') AND m.email <> n.email AND m.visible_to IS NULL
            AND NOT EXISTS (SELECT 1 FROM chat_email_welcome w WHERE w.email = n.email)
          ORDER BY n.message_id`
      )
        .bind(since)
        .all<{ email: string; channel_id: string; message_id: number; kind: string }>()
    ).results || [];
  for (const e of events) note(lower(e.email), e.channel_id, e.message_id, e.kind);
  const added =
    (
      await env.DB.prepare(
        `SELECT mem.channel_id, mem.email, mem.joined_at FROM chat_members mem JOIN chat_channels c ON c.id = mem.channel_id
          WHERE c.archived = 0 AND c.kind IN ('dm', 'group', 'private') AND mem.joined_at > ? AND mem.email <> c.created_by
            AND NOT EXISTS (SELECT 1 FROM chat_email_welcome w WHERE w.email = mem.email)`
      )
        .bind(since)
        .all<{ channel_id: string; email: string; joined_at: string }>()
    ).results || [];
  for (const j of added) {
    const m = await env.DB.prepare(
      `SELECT id FROM chat_messages WHERE channel_id = ? AND thread_id IS NULL AND deleted_at IS NULL AND visible_to IS NULL AND email <> ? AND email NOT IN ('brain', 'meetings', 'gifts') AND created_at >= ? AND created_at > ? ORDER BY id LIMIT 1`
    )
      .bind(j.channel_id, lower(j.email), j.joined_at, since)
      .first<{ id: number }>();
    if (m) note(lower(j.email), j.channel_id, m.id, 'start');
  }
  const welcomed = new Set<string>();
  for (const [email, l] of lead) {
    if (!(await eligible(env, email)) || (await failedLately(env, email, l.channel_id, now))) continue;
    out.push({ email, channel_id: l.channel_id, kind: 'welcome', ids: [l.id], why: l.why });
    welcomed.add(email);
  }

  // 1. Started a conversation with you: joined after the first run, first message from someone else, still unread.
  const joins =
    (
      await env.DB.prepare(
        `SELECT mem.channel_id, mem.email, mem.joined_at FROM chat_members mem JOIN chat_channels c ON c.id = mem.channel_id
          WHERE c.archived = 0 AND c.kind IN ('dm', 'group', 'private') AND mem.joined_at > ? AND mem.email <> c.created_by
            AND NOT EXISTS (SELECT 1 FROM chat_email_log l WHERE l.email = mem.email AND l.channel_id = mem.channel_id AND l.kind = 'start')`
      )
        .bind(since)
        .all<{ channel_id: string; email: string; joined_at: string }>()
    ).results || [];
  for (const j of joins) {
    const email = lower(j.email);
    if (welcomed.has(email)) continue;
    const first = await env.DB.prepare(
      `SELECT id FROM chat_messages WHERE channel_id = ? AND thread_id IS NULL AND deleted_at IS NULL AND visible_to IS NULL AND email <> ? AND email NOT IN ('brain', 'meetings', 'gifts') AND created_at >= ? AND created_at > ? ORDER BY id LIMIT 1`
    )
      .bind(j.channel_id, email, j.joined_at, since)
      .first<{ id: number }>();
    if (!first) continue;
    const done = await env.DB.prepare('SELECT 1 AS x FROM chat_email_sent WHERE email = ? AND message_id = ?').bind(email, first.id).first();
    if (done) continue;
    const read = await env.DB.prepare('SELECT last_read_id FROM chat_reads WHERE channel_id = ? AND email = ?').bind(j.channel_id, email).first<{ last_read_id: number }>();
    if (read && read.last_read_id >= first.id) continue;
    if (!(await allowed(env, email, j.channel_id, cutoff)) || (await failedLately(env, email, j.channel_id, now))) continue;
    out.push({ email, channel_id: j.channel_id, kind: 'start', ids: [first.id] });
    taken.add(email + '|' + j.channel_id);
  }

  // 2. Unread ten minutes later: one email per person and conversation.
  const rows =
    (
      await env.DB.prepare(
        `SELECT n.email, n.channel_id, n.message_id, n.created_at FROM chat_mentions n JOIN chat_messages m ON m.id = n.message_id JOIN chat_channels c ON c.id = n.channel_id
          WHERE n.read_at IS NULL AND n.created_at > ? AND m.deleted_at IS NULL AND c.archived = 0 AND m.email NOT IN ('brain', 'meetings', 'gifts') AND m.email <> n.email
            AND (m.visible_to IS NULL OR m.visible_to = n.email)
            AND (c.kind = 'public' OR n.email IN (SELECT email FROM chat_members WHERE channel_id = n.channel_id))
            AND n.message_id NOT IN (SELECT message_id FROM chat_email_sent s WHERE s.email = n.email)
          ORDER BY n.message_id`
      )
        .bind(since)
        .all<{ email: string; channel_id: string; message_id: number; created_at: string }>()
    ).results || [];
  const groups = new Map<string, { email: string; channel_id: string; ids: number[]; oldest: string }>();
  for (const r of rows) {
    const k = lower(r.email) + '|' + r.channel_id;
    const g = groups.get(k) || { email: lower(r.email), channel_id: r.channel_id, ids: [], oldest: r.created_at };
    g.ids.push(r.message_id);
    if (r.created_at < g.oldest) g.oldest = r.created_at;
    groups.set(k, g);
  }
  for (const [k, g] of groups) {
    if (taken.has(k) || welcomed.has(g.email) || g.oldest > cutoff) continue;
    if (!(await allowed(env, g.email, g.channel_id, cutoff))) continue;
    if (await waitingOnRead(env, g.email, g.channel_id)) continue;
    if (await failedLately(env, g.email, g.channel_id, now)) continue;
    out.push({ email: g.email, channel_id: g.channel_id, kind: 'unread', ids: g.ids });
  }
  return out;
}

/* ------------------------------------------------------------------ the run */

async function people(env: MailEnv, emails: string[]): Promise<Map<string, Person>> {
  const list = [...new Set(emails.map(lower))];
  const map = new Map<string, Person>();
  if (!list.length) return map;
  const r = await env.DB.prepare(`SELECT email, name, picture FROM hub_users WHERE lower(email) IN (${list.map(() => '?').join(',')})`).bind(...list).all<{ email: string; name: string; picture: string }>();
  for (const u of r.results || []) map.set(lower(u.email), { name: u.name || u.email.split('@')[0]!, picture: u.picture || '' });
  return map;
}

export interface RunResult {
  sent: number;
  skipped: number;
  failed: number;
  note?: string;
}

async function setStatus(env: MailEnv, text: string, bad: boolean): Promise<void> {
  const v = `${bad ? 'error' : 'ok'}|${nowIso()}|${text}`;
  await env.DB.prepare(
    `INSERT INTO act_settings (key, value, updated_at) VALUES ('chatmail:last', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(v, nowIso())
    .run()
    .catch(() => null);
}

/** The 5-minute pass. Safe to call as often as you like: every send takes its once-only rows first. */
export async function run(env: MailEnv, now = new Date()): Promise<RunResult> {
  const out: RunResult = { sent: 0, skipped: 0, failed: 0 };
  try {
    if (!(await ready(env))) return { ...out, note: 'tables not applied' };
    if ((await effective(env as Env, 'chat.email', undefined, 'on').catch(() => 'on')).toLowerCase() === 'off') return { ...out, note: 'switched off' };
    const row = await env.DB.prepare(`SELECT v FROM chat_email_state WHERE k = 'since'`).first<{ v: string }>();
    if (!row) {
      // The first run only marks the start. Nothing before this moment is ever emailed.
      await env.DB.prepare(`INSERT OR IGNORE INTO chat_email_state (k, v) VALUES ('since', ?)`).bind(now.toISOString()).run();
      await setStatus(env, 'started, nothing sent', false);
      return { ...out, note: 'first run' };
    }
    const list = await whoGetsEmail(env, row.v, now);
    for (const c of list) {
      const r = await sendOne(env, c, now).catch((err) => {
        console.warn('[chat email]', String(err).slice(0, 160));
        return 'failed' as const;
      });
      if (r === 'sent') out.sent++;
      else if (r === 'failed') out.failed++;
      else out.skipped++;
    }
    await setStatus(env, `${out.sent} sent, ${out.failed} failed`, out.failed > 0);
    return out;
  } catch (err) {
    await setStatus(env, String(err).slice(0, 160), true);
    throw err;
  }
}

/** An admin's @here: the one message that goes through quiet hours. */
async function urgentIds(env: MailEnv, ids: number[]): Promise<boolean> {
  if (!ids.length) return false;
  const rows = (await env.DB.prepare(`SELECT m.email, m.body, COALESCE(u.role, '') AS role FROM chat_messages m LEFT JOIN hub_users u ON lower(u.email) = m.email WHERE m.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ email: string; body: string; role: string }>()).results || [];
  return rows.some((r) => parseMentions(r.body).here && (r.role === 'admin' || isAdminEmail(env as Env, r.email)));
}

async function sendOne(env: MailEnv, c: Candidate, now: Date): Promise<'sent' | 'failed' | 'skipped'> {
  // Quiet hours (quiet.ts): the welcome waits until they end; any other email is held for the morning summary.
  const quiet = (await quietNow(env, [c.email], now).catch(() => new Set<string>())).has(c.email) && !(await urgentIds(env, c.ids).catch(() => false));
  if (quiet && c.kind === 'welcome') return 'skipped';
  if (c.kind === 'welcome') {
    // Each person is welcomed exactly once, ever: the row is taken before the send.
    const w = await env.DB.prepare('INSERT OR IGNORE INTO chat_email_welcome (email, sent_at, message_id) VALUES (?, ?, ?)').bind(c.email, now.toISOString(), c.ids[0]).run();
    if (Number((w.meta as { changes?: number }).changes) === 0) return 'skipped';
  }
  // Take the once-only rows first. A pass that lost the race for every message sends nothing.
  const log = await env.DB.prepare(`INSERT INTO chat_email_log (email, channel_id, kind, message_ids, sent_at, state) VALUES (?, ?, ?, ?, ?, 'sending')`).bind(c.email, c.channel_id, c.kind, JSON.stringify(c.ids), now.toISOString()).run();
  const logId = Number((log.meta as { last_row_id?: number }).last_row_id);
  const mine: number[] = [];
  for (const id of c.ids) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO chat_email_sent (email, message_id, log_id) VALUES (?, ?, ?)').bind(c.email, id, logId).run();
    if (Number((r.meta as { changes?: number }).changes) > 0) mine.push(id);
  }
  const drop = async (state: string) => {
    if (state !== 'sent' && c.kind === 'welcome') await env.DB.prepare('DELETE FROM chat_email_welcome WHERE email = ?').bind(c.email).run();
    await env.DB.prepare('UPDATE chat_email_log SET state = ?, message_ids = ? WHERE id = ?').bind(state, JSON.stringify(mine), logId).run();
  };
  if (!mine.length) {
    await drop('failed');
    return 'skipped';
  }
  const ch = await env.DB.prepare('SELECT id, kind, name FROM chat_channels WHERE id = ?').bind(c.channel_id).first<{ id: string; kind: ChatKind; name: string }>();
  const shown = c.kind === 'welcome' ? mine : mine.slice(-SHOWN);
  const msgs = (
    await env.DB.prepare(`SELECT m.id, m.channel_id, m.email, m.body, m.created_at, m.thread_id FROM chat_messages m WHERE m.id IN (${shown.map(() => '?').join(',')}) ORDER BY m.id`).bind(...shown).all<MsgRow>()
  ).results || [];
  if (!ch || !msgs.length) {
    await drop('failed');
    return 'skipped';
  }
  const members = (await env.DB.prepare('SELECT email FROM chat_members WHERE channel_id = ? ORDER BY joined_at, email').bind(ch.id).all<{ email: string }>()).results?.map((x) => lower(x.email)) || [];
  const dir = await people(env, [c.email, ...members, ...msgs.map((m) => m.email), ...msgs.flatMap((m) => [...m.body.matchAll(/<@([^>]+)>/g)].map((x) => x[1]!))]);
  const nameOf = (e: string) => dir.get(lower(e))?.name || lower(e).split('@')[0] || 'Someone';
  const why = new Map(
    ((await env.DB.prepare(`SELECT message_id, kind FROM chat_mentions WHERE email = ? AND message_id IN (${shown.map(() => '?').join(',')})`).bind(c.email, ...shown).all<{ message_id: number; kind: string }>()).results || []).map((x) => [x.message_id, x.kind])
  );
  const messages: ChatMailMessage[] = msgs.map((m) => ({
    who: { name: nameOf(m.email), picture: dir.get(lower(m.email))?.picture || '' },
    id: m.id,
    body: plainBody(m.body, nameOf),
    at: m.created_at,
    why: c.kind === 'welcome' ? c.why : why.get(m.id),
  }));
  const mail = buildChatMail({
    kind: c.kind,
    to: { email: c.email, name: nameOf(c.email) },
    channel: ch,
    others: members.filter((e) => e !== c.email && !SYSTEM_VOICES.has(e) && !isTester(e)).map(nameOf),
    messages,
    total: c.kind === 'welcome' ? 1 : mine.length,
    origin: ORIGIN,
    now,
    off: await offLinkFor(env, c.email),
  });
  if (quiet) {
    const where = ch.kind === 'public' || ch.kind === 'private' ? ` in #${ch.name}` : '';
    for (const m of messages) await hold(env, c.email, { kind: 'chat', title: `${m.who.name}${where}`, body: m.body.replace(/\s+/g, ' ').slice(0, 200), url: chatLink('', ch.id, m.id), messageId: m.id }, now);
    await drop('held');
    return 'skipped';
  }
  const ok = await send(env as Env, { to: c.email, ...mail, fromName: 'FavorOS Chat' }).catch(() => false);
  if (ok) {
    await drop('sent');
    return 'sent';
  }
  // A failed send gives the messages back so the next pass can try once more.
  await env.DB.prepare(`DELETE FROM chat_email_sent WHERE log_id = ?`).bind(logId).run();
  await drop('failed');
  return 'failed';
}
