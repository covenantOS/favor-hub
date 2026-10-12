// Mail reaching the rest of FavorOS: hand a conversation to a teammate (assign), tell a coworker about one (mention), and turn one into a
// request card. A teammate cannot open someone else's Gmail, so what travels is the subject, the sender and the one-line preview Mail
// already shows, plus the person's note. Chat notices go through the same store the Chat page uses, so the bell and the unread counts
// work as for any message. Tests pass stand-ins (MailCtx.chat, MailCtx.makeRequest) and never reach real staff.
import type { Env } from '../http';
import { HttpError, nowIso } from '../http';
import { staffDirectory } from '../people';

export interface Brief {
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  link: string;
}

export type ChatPost = (from: string, to: string, body: string) => Promise<void>;
export type MakeRequest = (input: { title: string; body: string; surface: string; name: string; email: string; link: string }) => Promise<{ id: string }>;

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const clean = (s: unknown, max: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A staff member by address, from the directory: Mail never sends a notice to an address the directory does not know. */
export async function staffByEmail(env: Env, email: string): Promise<{ email: string; name: string } | null> {
  const e = lower(email);
  const p = (await staffDirectory(env).catch(() => [])).find((x) => x.email === e);
  return p ? { email: p.email, name: p.name } : null;
}

export async function defaultChat(env: Env): Promise<ChatPost> {
  const store = await import('../chat/db');
  return async (from, to, body) => {
    const ch = await store.openConversation(env as any, from, [to]);
    await store.post(env as any, { channel_id: ch.id, email: from, body });
  };
}

export async function defaultRequest(env: Env): Promise<MakeRequest> {
  const { insertRequest } = await import('../db');
  const { notifyNewRequest } = await import('../notify');
  return async (i) => {
    const row = await insertRequest(env, { title: i.title, body: i.body, surface: (['website', 'portal', 'dashboard', 'app'].includes(i.surface) ? i.surface : 'dashboard') as any, submitter_name: i.name, submitter_email: i.email, source: 'mail' });
    await notifyNewRequest(env, row).catch((e) => console.error('[mail] request notice', e));
    return { id: row.id };
  };
}

const lineOf = (b: Brief, note: string, lead: string) => `${lead}\n**${clean(b.subject, 160) || '(no subject)'}**\nFrom ${clean(b.from, 120)}: ${clean(b.snippet, 220)}${note ? '\n\n' + clean(note, 600) : ''}`;

/** Hands a conversation to a teammate: a Chat notice to them and a row so the person can see what they handed off and what came back. */
export async function assign(env: Env, chat: ChatPost, me: string, name: string, to: string, b: Brief, note: string): Promise<{ id: string; to: string; name: string }> {
  const who = await staffByEmail(env, to);
  if (!who) throw new HttpError(400, 'not_staff', 'Pick someone on the Favor staff list.');
  if (who.email === lower(me)) throw new HttpError(400, 'self', 'Pick someone other than you.');
  const id = 'a_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await chat(lower(me), who.email, lineOf(b, note, `${name || 'I'} asked you to take this email:`));
  await env.DB.prepare('INSERT INTO hub_mail_assign (id, owner, thread_id, assignee, subject, note, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, lower(me), b.threadId, who.email, clean(b.subject, 200), clean(note, 600), 'open', nowIso()).run();
  return { id, to: who.email, name: who.name };
}

export async function assigned(env: Env, me: string): Promise<Array<{ id: string; threadId: string; assignee: string; name: string; subject: string; note: string; state: string; at: string }>> {
  const r = await env.DB.prepare("SELECT id, thread_id, assignee, subject, note, state, created_at FROM hub_mail_assign WHERE owner = ? ORDER BY (state = 'open') DESC, created_at DESC LIMIT 60").bind(lower(me)).all<any>().catch(() => ({ results: [] as any[] }));
  const dir = await staffDirectory(env).catch(() => []);
  return (r.results || []).map((x: any) => ({ id: x.id, threadId: x.thread_id, assignee: x.assignee, name: dir.find((p) => p.email === x.assignee)?.name || x.assignee, subject: x.subject, note: x.note, state: x.state, at: x.created_at }));
}

export async function finishAssigned(env: Env, me: string, id: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE hub_mail_assign SET state = 'done', done_at = ? WHERE id = ? AND owner = ? AND state = 'open'").bind(nowIso(), id, lower(me)).run();
  return Number((r.meta as any)?.changes) > 0;
}

/** Tells coworkers about a conversation, each in their own direct message, with the person's note. Up to five people. */
export async function mention(env: Env, chat: ChatPost, me: string, name: string, to: string[], b: Brief, note: string): Promise<string[]> {
  const sent: string[] = [];
  for (const e of [...new Set(to.map(lower))].slice(0, 5)) {
    const who = await staffByEmail(env, e);
    if (!who || who.email === lower(me)) continue;
    await chat(lower(me), who.email, lineOf(b, note, `${name || 'I'} want your eyes on this email:`));
    sent.push(who.email);
  }
  if (!sent.length) throw new HttpError(400, 'not_staff', 'Pick someone on the Favor staff list.');
  return sent;
}

/** Makes a request card from a conversation, filed as the person, with the preview and the person's own link back to the email. */
export async function requestFrom(make: MakeRequest, me: string, name: string, b: Brief, note: string, surface: string): Promise<{ id: string; url: string }> {
  const title = clean(b.subject, 150) || 'Request from an email';
  const body = [clean(note, 2000), `From ${clean(b.from, 120)}: ${clean(b.snippet, 400)}`, `Email: ${b.link}`].filter(Boolean).join('\n\n');
  const r = await make({ title, body, surface, name: name || me, email: lower(me), link: b.link });
  return { id: r.id, url: `/requests/?r=${encodeURIComponent(r.id)}` };
}
