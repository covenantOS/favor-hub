// Move to Chat: an email conversation between staff only can continue in FavorOS Chat. Mail suggests it (a flag on the thread
// answer, no extra call), and one click opens the Chat conversation for exactly those people, posts the email history as the
// first message, pins it and, if the person chose, sends a short note into the email thread. The server decides every time:
// each person on the thread must be an active FavorOS staff user and may use Chat; nothing the page says is trusted.
//
// The test users (functions/_lib/testuser.ts) qualify only with each other, and a real person never qualifies with a test user,
// so a test conversation can never reach a real mailbox or a real Chat.
import { allowedBy, featureMode, groupMembers } from '../access';
import { nowIso, type Env } from '../http';
import { isHiddenAccount, isTester } from '../testuser';
import { freshText } from './smart';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** A group in Chat holds up to nine people (functions/_lib/chat/db.ts openConversation). */
export const MAX_PEOPLE = 9;
/** Chat keeps a message to 4000 characters (functions/_lib/chat/text.ts MAX_BODY). */
const CHAT_MAX = 4000;
const BUDGET = 3900;
const PER_MESSAGE = 1500;

export interface Who {
  email: string;
  name: string;
}
export interface TeamChat {
  ok: boolean;
  people: Who[];
  /** '' = offered, 'moved' = already in Chat, 'dismissed' = the person hid the suggestion. */
  state: '' | 'moved' | 'dismissed';
  channel: string;
  link: string;
}
export interface UserRow {
  email: string;
  name: string;
  role: string;
  blocked: number;
  pending: number;
}
interface Addr {
  name?: string;
  email?: string;
}
interface Msg {
  draft?: boolean;
  from?: Addr;
  to?: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
}

export const NO_TEAM: TeamChat = { ok: false, people: [], state: '', channel: '', link: '' };

/** Every address that wrote or received a sent message in the thread, with the name its header gave. Drafts are not yet part of it. */
export function threadPeople(msgs: Msg[]): Who[] {
  const seen = new Map<string, string>();
  for (const m of msgs) {
    if (m.draft) continue;
    for (const a of [m.from, ...(m.to || []), ...(m.cc || []), ...(m.bcc || [])]) {
      const e = lower(a?.email);
      if (!e) continue;
      if (!seen.has(e) || (!seen.get(e) && a?.name)) seen.set(e, String(a?.name || '').trim());
    }
  }
  return [...seen].map(([email, name]) => ({ email, name }));
}

/**
 * The staff-only test, with no database: the viewer and everyone else on the thread are in hub_users as admin or staff, not blocked,
 * not waiting for approval. Two people or up to nine. A test user qualifies only when everyone is a test user.
 */
export function staffOnly(people: Who[], viewer: string, users: Map<string, UserRow>): { ok: boolean; people: Who[]; why: string } {
  const me = lower(viewer);
  const all = new Map<string, string>();
  all.set(me, '');
  for (const p of people) all.set(lower(p.email), p.name || all.get(lower(p.email)) || '');
  const emails = [...all.keys()];
  if (emails.length < 2) return { ok: false, people: [], why: 'alone' };
  if (emails.length > MAX_PEOPLE) return { ok: false, people: [], why: 'too_many' };
  const tester = isTester(me);
  for (const e of emails) {
    if (isTester(e) !== tester) return { ok: false, people: [], why: 'test_mix' };
    if (!tester && isHiddenAccount(e)) return { ok: false, people: [], why: 'hidden' };
    const u = users.get(e);
    if (!u || u.blocked || u.pending || (u.role !== 'admin' && u.role !== 'staff')) return { ok: false, people: [], why: 'not_staff' };
  }
  return { ok: true, people: emails.map((e) => ({ email: e, name: users.get(e)?.name || all.get(e) || e.split('@')[0] })), why: '' };
}

async function usersOf(env: Pick<Env, 'DB'>, emails: string[]): Promise<Map<string, UserRow>> {
  const out = new Map<string, UserRow>();
  const q = (cols: string) => env.DB.prepare(`SELECT lower(email) AS email, name, role, blocked, ${cols} AS pending FROM hub_users WHERE lower(email) IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(emails));
  // A database that predates the pending column answers with 0; any other failure is tried once more, then reported (never read as "nobody is staff").
  const read = async (cols: string): Promise<UserRow[]> => ((await q(cols).all<UserRow>()).results || []);
  let rows: UserRow[];
  try {
    rows = await read('pending');
  } catch (e) {
    if (/no such column/i.test(String((e as Error)?.message))) rows = await read('0');
    else rows = await read('pending');
  }
  for (const u of rows) out.set(lower(u.email), { ...u, email: lower(u.email) });
  return out;
}

const ready = new WeakSet<object>();
/** The table is made the first time it is needed (db/mail-tochat.sql carries the same statement). */
async function ensure(env: Pick<Env, 'DB'>): Promise<void> {
  if (ready.has(env.DB as object)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS hub_mail_chat (owner TEXT NOT NULL, thread_id TEXT NOT NULL, state TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT \'\', message_id INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (owner, thread_id))').run().catch(() => undefined);
  ready.add(env.DB as object);
}

export const chatLink = (origin: string, channel: string) => `${origin.replace(/\/$/, '')}/chat/?c=${encodeURIComponent(channel)}`;

/**
 * Whether this conversation can move to Chat for this viewer. Cheap: one read of hub_users, the Chat access setting and one row
 * of this table, and nothing at all when the thread has fewer than two people or more than nine.
 */
export async function teamChat(env: Pick<Env, 'DB'>, msgs: Msg[], viewer: string, threadId: string, origin: string): Promise<TeamChat> {
  const me = lower(viewer);
  const people = threadPeople(msgs);
  const count = new Set([me, ...people.map((p) => lower(p.email))]).size;
  if (count < 2 || count > MAX_PEOPLE) return NO_TEAM;
  const emails = [...new Set([me, ...people.map((p) => p.email)])];
  const users = await usersOf(env, emails);
  const verdict = staffOnly(people, me, users);
  if (!verdict.ok) return NO_TEAM;
  // Everyone must be able to use Chat: the setting and the access group (functions/_lib/access.ts), the same test Chat applies to each person.
  const mode = await featureMode(env as Env, 'chat');
  const members = mode === 'group' ? await groupMembers(env as Env, 'chat') : null;
  if (emails.some((e) => !allowedBy(mode, members, { email: e, role: users.get(e)?.role, via: 'google' }))) return NO_TEAM;
  await ensure(env);
  const row = await env.DB.prepare('SELECT state, channel_id FROM hub_mail_chat WHERE owner = ? AND thread_id = ?').bind(me, threadId).first<{ state: string; channel_id: string }>().catch(() => null);
  const state = row?.state === 'moved' ? 'moved' : row?.state === 'dismissed' ? 'dismissed' : '';
  return { ok: true, people: verdict.people, state, channel: state === 'moved' ? row!.channel_id : '', link: state === 'moved' ? chatLink(origin, row!.channel_id) : '' };
}

export async function rememberMove(env: Pick<Env, 'DB'>, owner: string, threadId: string, state: 'moved' | 'dismissed', channel = '', messageId = 0): Promise<void> {
  await ensure(env);
  await env.DB.prepare('INSERT INTO hub_mail_chat (owner, thread_id, state, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner, thread_id) DO UPDATE SET state = excluded.state, channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at').bind(lower(owner), threadId, state, channel, messageId, nowIso()).run();
}

/** The words of one message for Chat: the newest text without quoted mail, a signature or a "sent from" line. */
export function chatWords(m: { text: string; html: string; snippet: string }): string {
  let t = freshText(m);
  const cut = t.search(/\n\s*-- ?\n|\n\s*(Sent from my |Get Outlook for |Sent from Mail for )/i);
  if (cut > 0) t = t.slice(0, cut);
  t = t.replace(/<@/g, '< @');
  return t.replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
};

/**
 * The first Chat message: the subject, then each email as "Name, date: text" oldest first. A long message is cut at 1,500 characters;
 * when the whole history is longer than Chat allows, the oldest emails are left out and a line says so. Never longer than 4,000.
 */
export function historyText(subject: string, items: Array<{ name: string; date: string; text: string }>): string {
  const head = `Moved from email: ${String(subject || '(no subject)').replace(/\s+/g, ' ').trim().slice(0, 200)}`;
  const parts = items.map((i) => {
    const t = i.text.length > PER_MESSAGE ? i.text.slice(0, PER_MESSAGE).replace(/\s+\S*$/, '') + '...' : i.text;
    return `${i.name}, ${day(i.date)}: ${t || '(no text)'}`;
  });
  let from = 0;
  const size = (f: number) => head.length + (f > 0 ? 60 : 0) + parts.slice(f).reduce((n, p) => n + p.length + 2, 0);
  while (from < parts.length - 1 && size(from) > BUDGET) from++;
  const body = parts.slice(from);
  if (body.length === 1 && size(from) > BUDGET) body[0] = body[0].slice(0, BUDGET - head.length - 70).replace(/\s+\S*$/, '') + '...';
  const out = [head, ...(from > 0 ? [`(${from} earlier ${from === 1 ? 'message is' : 'messages are'} in the email thread.)`] : []), ...body].join('\n\n');
  return out.slice(0, CHAT_MAX);
}

/** Hides the suggestion for this conversation. A conversation already moved stays moved. */
export async function dismiss(env: Pick<Env, 'DB'>, owner: string, threadId: string): Promise<void> {
  await ensure(env);
  await env.DB.prepare("INSERT INTO hub_mail_chat (owner, thread_id, state, updated_at) VALUES (?, ?, 'dismissed', ?) ON CONFLICT(owner, thread_id) DO UPDATE SET state = 'dismissed', updated_at = excluded.updated_at WHERE hub_mail_chat.state != 'moved'").bind(lower(owner), threadId, nowIso()).run();
}
