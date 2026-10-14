// Telling one staff member about something from another app: a hand-off, a nudge, "picked up". Chat when the person is in the Chat
// group (a direct message from the sender, so it lands in the bell, the dock and on their phone), email when they are not.
// The test accounts reach only each other: a tester never pings a real person, and a real person is never pinged about a tester.
import { nowIso, type Env } from '../http';
import { allowedAmong } from '../access';
import { isHiddenAccount, isTester, TESTER_EMAIL, TESTER2_EMAIL, TESTER_NAME, TESTER2_NAME } from '../testuser';
import { staffDirectory } from '../people';
import { sendMail } from '../notify/send';
import { shell, btn } from '../projects/links/email';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export interface Person {
  email: string;
  name: string;
  title?: string;
  team?: string;
  picture?: string;
}

/** The people this person may hand something to or nudge: the staff list without the hidden accounts. A tester sees only the other tester. */
export async function peopleFor(env: Pick<Env, 'DB'>, me: string): Promise<Person[]> {
  const m = lower(me);
  if (isTester(m)) return [m === TESTER_EMAIL ? { email: TESTER2_EMAIL, name: TESTER2_NAME } : { email: TESTER_EMAIL, name: TESTER_NAME }];
  const dir = await staffDirectory(env).catch(() => []);
  return dir.filter((p) => p.email !== m && !isHiddenAccount(p.email)).map((p) => ({ email: p.email, name: p.name, title: p.title, team: p.team, picture: p.picture }));
}

/** True when `from` may reach `to` at all (the test-account wall). */
export function mayReach(from: string, to: string): boolean {
  const a = lower(from);
  const b = lower(to);
  if (!b || a === b) return false;
  if (isTester(a) || isTester(b)) return isTester(a) && isTester(b);
  return !isHiddenAccount(b);
}

export interface PingInput {
  from: { email: string; name: string };
  to: string;
  /** The chat text (markdown with <@email> tokens allowed). */
  chat: string;
  /** Email subject and the lines of the email body (plain sentences). */
  subject: string;
  lines: string[];
  /** The FavorOS address the email's button opens (a path such as /h/abc). */
  href: string;
  button: string;
  origin?: string;
}

export interface PingResult {
  channel: 'chat' | 'email' | 'none';
  messageId?: number;
  channelId?: string;
}

/** Chat first (when the person is in the Chat group), else email. Returns the channel used, 'none' when neither could reach them. */
export async function ping(env: Env, p: PingInput, fetcher: typeof fetch = fetch): Promise<PingResult> {
  const from = lower(p.from.email);
  const to = lower(p.to);
  if (!mayReach(from, to)) return { channel: 'none' };
  // Testers always use Chat between themselves (their private DM), never email.
  const both = isTester(from) && isTester(to);
  const chatOk = both || ((await allowedAmong(env, 'chat', [from, to]).catch(() => [] as string[])).length === 2);
  if (chatOk) {
    try {
      const store = await import('../chat/db');
      const ch = await store.openConversation(env as never, from, [to]);
      const posted = await postChat(env, { email: from, name: p.from.name }, ch.id, p.chat, null, fetcher);
      return { channel: 'chat', messageId: posted.id, channelId: ch.id };
    } catch (err) {
      console.warn('[ping] chat', String(err).slice(0, 200));
      if (both) return { channel: 'none' };
    }
  }
  if (both) return { channel: 'none' };
  const origin = (p.origin || 'https://dash.favorintl.org').replace(/\/$/, '');
  const url = p.href.startsWith('http') ? p.href : origin + p.href;
  const body = p.lines.filter(Boolean).map((l) => `<p style="margin:0 0 12px;font:400 15px/1.5 Arial,sans-serif;color:#1f241c">${esc(l)}</p>`).join('');
  const html = shell(`<tr><td style="padding:20px 28px 8px">${body}</td></tr><tr><td style="padding:8px 28px 28px">${btn(url, p.button, true)}</td></tr>`, 'FavorOS');
  const ok = await sendMail(env, { to, subject: p.subject.slice(0, 160), html, text: [...p.lines, '', `${p.button}: ${url}`].join('\n'), fromName: p.from.name || 'FavorOS', replyTo: from }).catch(() => false);
  return { channel: ok ? 'email' : 'none' };
}

/** Posts as a person into a conversation they are in, then sends it live and to locked phones, the way the Chat page does. */
export async function postChat(env: Env, who: { email: string; name: string }, channelId: string, body: string, threadId: number | null, fetcher: typeof fetch = fetch): Promise<{ id: number }> {
  const store = await import('../chat/db');
  const posted = await store.post(env as never, { channel_id: channelId, email: lower(who.email), body: body.slice(0, 3800), thread_id: threadId });
  if ((env as { CHAT_ROOM?: unknown }).CHAT_ROOM) {
    const live = await import('../chat/live');
    const [msg] = await store.shape(env as never, [posted.message]);
    await live.publish(env as never, store.audienceOf(posted.message, posted.members), { type: 'message', message: msg }).catch(() => undefined);
  }
  const push = await import('../push');
  await push.pushForPost(env as never, { notify: posted.notify, channel: posted.channel as never, senderName: who.name || who.email, text: body, messageId: posted.message.id, threadId }, fetcher).catch(() => 0);
  return { id: posted.message.id };
}

export const stamp = nowIso;
