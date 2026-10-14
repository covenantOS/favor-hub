// Find a time from anywhere: an email, a Chat conversation or thread, a task, a partner, a request.
//   contextFor()   who the meeting is with and a title, read from the place, for the person asking (they must see the place)
//   linkOrigin()   after the meeting is booked (the usual /api/meet/meetings route: Google invite, FavorOS meeting), the meeting card
//                  goes back into the place it came from: a card in the Chat conversation or thread, a comment on the task or the
//                  request. An email gets the card in the reply window on the page (never sent by itself), a partner gets nothing
//                  posted: the meeting shows on the partner's timeline by its attendee.
//   originNotes()  when the notes are ready (afterNotes in meetauto.ts), one post back in the same place, once. The summary and
//                  action items go only into a private conversation whose members may all read the notes; everywhere else gets one
//                  line and the link, and the notes page keeps its own rule (mayReadNotes).
import { HttpError, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { isTester } from '../testuser';
import * as store from '../chat/db';
import { MEETINGS_ID } from '../chat/text';
import { hydrateAttachments } from '../chat/hydrate';
import { publish, type LiveEnv } from '../chat/live';
import { notesOpenToConversation } from '../chat/meet';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
export const KINDS = ['chat', 'mail', 'task', 'partner', 'request'] as const;
export type OriginKind = (typeof KINDS)[number];
const ET = 'America/New_York';

export interface Person { email: string; name: string; guest: boolean }
export interface Context { ok: true; kind: OriginKind; ref: string; thread: number | null; title: string; people: Person[] }

const actorOf = (u: HubUser) => ({ email: lower(u.email), name: u.name || u.email, admin: u.role === 'admin' });

async function names(env: Env, emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!emails.length) return out;
  const marks = emails.map(() => '?').join(',');
  const r = await env.DB.prepare(`SELECT lower(email) AS email, name FROM meet_directory WHERE lower(email) IN (${marks})`).bind(...emails).all<{ email: string; name: string }>().catch(() => ({ results: [] as Array<{ email: string; name: string }> }));
  for (const x of r.results || []) if (x.name) out.set(x.email, x.name);
  const u = await env.DB.prepare(`SELECT lower(email) AS email, name FROM hub_users WHERE lower(email) IN (${marks})`).bind(...emails).all<{ email: string; name: string }>().catch(() => ({ results: [] as Array<{ email: string; name: string }> }));
  for (const x of u.results || []) if (x.name && !out.has(x.email)) out.set(x.email, x.name);
  return out;
}

function people(list: string[], dir: Map<string, string>, me: string, tester: boolean): Person[] {
  const seen = new Set<string>([me]);
  const out: Person[] = [];
  for (const raw of list) {
    const e = lower(raw);
    if (!EMAIL.test(e) || seen.has(e)) continue;
    if (!tester && isTester(e)) continue; // the test users never appear to real people
    seen.add(e);
    out.push({ email: e, name: dir.get(e) || '', guest: !FAVOR.test(e) });
  }
  return out.slice(0, 40);
}

/** The people and title for a place. The person asking must be able to see it: a Chat member, a task they may see, any request. */
export async function contextFor(env: Env, user: HubUser, kindRaw: unknown, refRaw: unknown, threadRaw?: unknown): Promise<Context> {
  const kind = lower(kindRaw) as OriginKind;
  const ref = String(refRaw ?? '').trim().slice(0, 120);
  if (!KINDS.includes(kind) || !ref) throw new HttpError(400, 'bad_place', 'Pick where the meeting comes from.');
  const me = lower(user.email);
  const tester = isTester(me);
  const thread = Number(threadRaw) > 0 ? Number(threadRaw) : null;
  if (kind === 'chat') {
    const ch = await store.getChannel(env as never, ref);
    if (!ch || !(await store.isMember(env as never, ref, me))) throw new HttpError(404, 'not_found', 'That conversation is gone.');
    const members = (await store.membersOf(env as never, ref)).filter((e) => !['brain', 'meetings', 'gifts'].includes(e));
    const dir = await names(env, members);
    const list = people(members, dir, me, tester);
    const title = ch.kind === 'public' || ch.kind === 'private' ? `#${ch.name}` : list.length ? `Meet with ${list.slice(0, 3).map((p) => (p.name || p.email).split(' ')[0]).join(', ')}` : 'Meeting';
    return { ok: true, kind, ref, thread, title: title.slice(0, 140), people: list };
  }
  if (kind === 'task') {
    const { taskAccess } = await import('../projects/tasks');
    const { task } = await taskAccess(env, actorOf(user), ref);
    const ppl = await env.DB.prepare('SELECT email FROM hub_task_people WHERE task_id = ?').bind(task.id).all<{ email: string }>().catch(() => ({ results: [] as Array<{ email: string }> }));
    const emails = [task.owner_email || '', task.created_by || '', ...(ppl.results || []).map((r) => r.email)].map(lower).filter(Boolean);
    const dir = await names(env, emails);
    return { ok: true, kind, ref: task.id, thread: null, title: task.title.slice(0, 140), people: people(emails, dir, me, tester) };
  }
  if (kind === 'request') {
    const { readable, taskOf, followersOf } = await import('../requests/tasks');
    const row = await readable(env as never, ref, actorOf(user));
    const t = await taskOf(env as never, row.id).catch(() => null);
    const fol = await followersOf(env as never, row.id).catch(() => []);
    const emails = [row.submitter_email || '', t?.owner_email || '', ...fol.filter((f) => !f.muted && f.why !== 'follow').map((f) => f.email)].map(lower).filter(Boolean);
    const dir = await names(env, emails);
    return { ok: true, kind, ref: row.id, thread: null, title: row.title.slice(0, 140), people: people(emails, dir, me, tester) };
  }
  // Mail and partner: the page already shows who is on the thread or the record; it sends them in linkOrigin's place.
  return { ok: true, kind, ref, thread: null, title: '', people: [] };
}

interface MeetingRow { id: string; title: string; host_email: string; cohosts: string; starts_at: string | null; status: string; summary: string; notes_json: string; invitees: string }

async function meetingOf(env: Env, id: string): Promise<MeetingRow> {
  const m = await env.DB.prepare('SELECT id, title, host_email, cohosts, starts_at, status, summary, notes_json, invitees FROM hub_meetings WHERE id = ?').bind(id).first<MeetingRow>();
  if (!m) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  return m;
}

const whenLine = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'time to be set');
const ORIGIN = 'https://dash.favorintl.org';

async function live(env: Env, row: store.MessageRow): Promise<void> {
  if (!(env as unknown as LiveEnv).CHAT_ROOM) return;
  const [msg] = await store.shape(env as never, [row], (a, ch) => hydrateAttachments(env as never, a, ch));
  await publish(env as unknown as LiveEnv, store.audienceOf(row, await store.membersOf(env as never, row.channel_id)), { type: 'message', message: msg });
}

/**
 * The meeting was booked from this place. Only the host may tie it, once per meeting, and only to a place they can see. Returns
 * what was posted, so the page can say so.
 */
export async function linkOrigin(env: Env, user: HubUser, b: Record<string, unknown>): Promise<{ ok: true; posted: 'chat' | 'task' | 'request' | 'none'; messageId: number | null }> {
  const id = String(b.meeting_id || '').trim().slice(0, 40);
  const m = await meetingOf(env, id);
  const me = lower(user.email);
  if (lower(m.host_email) !== me) throw new HttpError(403, 'host_only', 'Only the person who booked the meeting can tie it to a conversation.');
  const ctx = await contextFor(env, user, b.kind, b.ref, b.thread_id);
  const had = await env.DB.prepare('SELECT 1 AS ok FROM hub_meeting_origins WHERE meeting_id = ?').bind(id).first().catch(() => null);
  if (had) return { ok: true, posted: 'none', messageId: null };
  let posted: 'chat' | 'task' | 'request' | 'none' = 'none';
  let messageId: number | null = null;
  const line = `Booked: ${m.title || 'Meeting'}, ${whenLine(m.starts_at)}. ${ORIGIN}/meet/?m=${m.id}`;
  if (ctx.kind === 'chat') {
    const p = await store.post(env as never, { channel_id: ctx.ref, email: me, body: '', thread_id: ctx.thread, attachments: [{ type: 'meeting', id: m.id }] });
    messageId = p.message.id;
    await live(env, p.message).catch(() => undefined);
    posted = 'chat';
  } else if (ctx.kind === 'task') {
    const { addComment } = await import('../projects/tasks');
    const { fire } = await import('../projects/hooks');
    const actor = actorOf(user);
    const made = await addComment(env, actor, ctx.ref, { body: line }, { source: 'meeting' });
    await fire(env, { kind: 'task.comment', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { comment: made.comment }, told: made.told }).catch(() => undefined);
    posted = 'task';
  } else if (ctx.kind === 'request') {
    const { addComment, readable } = await import('../requests/tasks');
    const row = await readable(env as never, ctx.ref, actorOf(user));
    await addComment(env as never, row, actorOf(user), line, { source: 'board' }).catch(() => undefined);
    posted = 'request';
  }
  await env.DB.prepare('INSERT OR IGNORE INTO hub_meeting_origins (meeting_id, kind, ref, thread_id, card_message_id, booked_by, created_at, notes_posted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(id, ctx.kind, ctx.ref, ctx.thread, messageId, me, nowIso())
    .run();
  return { ok: true, posted, messageId };
}

/** Notes are ready: one post back where the meeting was booked from. Called from afterNotes; never throws into the notes step. */
export async function originNotes(env: Env, meetingId: string): Promise<boolean> {
  const o = await env.DB.prepare('SELECT * FROM hub_meeting_origins WHERE meeting_id = ?').bind(meetingId).first<{ kind: OriginKind; ref: string; thread_id: number | null; card_message_id: number | null; booked_by: string; notes_posted: number }>().catch(() => null);
  if (!o || o.notes_posted) return false;
  const claim = await env.DB.prepare('UPDATE hub_meeting_origins SET notes_posted = 1 WHERE meeting_id = ? AND notes_posted = 0').bind(meetingId).run();
  if (Number((claim.meta as { changes?: number }).changes) !== 1) return false;
  const m = await meetingOf(env, meetingId);
  const link = `${ORIGIN}/meet/notes/?m=${m.id}`;
  try {
    if (o.kind === 'chat') {
      const ch = await store.getChannel(env as never, o.ref);
      if (!ch) return false;
      const lines = [`Notes are ready for ${m.title || 'the meeting'}.`];
      if (await notesOpenToConversation(env, m.id, o.ref)) {
        const notes = (() => { try { return JSON.parse(m.notes_json || '{}') as { actions?: Array<{ owner?: string; text?: string }> }; } catch { return {}; } })();
        if (m.summary) lines.push('', String(m.summary).slice(0, 700));
        const acts = (notes.actions || []).filter((a) => a && a.text).slice(0, 6);
        if (acts.length) lines.push('', 'Action items', ...acts.map((a) => `- ${a.owner ? a.owner + ': ' : ''}${a.text}`));
      }
      const root = o.thread_id || o.card_message_id || null;
      const p = await store.post(env as never, { channel_id: o.ref, email: MEETINGS_ID, body: lines.join('\n').trim(), thread_id: root, attachments: [{ type: 'meeting', id: m.id }] });
      await live(env, p.message).catch(() => undefined);
      return true;
    }
    // A task or a request is read by people who may not be on the meeting: one line and the link; the notes page decides who reads.
    const line = `Notes are ready for ${m.title || 'the meeting'}: ${link}`;
    const booker = await env.DB.prepare('SELECT email, name, role FROM hub_users WHERE lower(email) = ?').bind(lower(o.booked_by)).first<{ email: string; name: string; role: string }>().catch(() => null);
    const actor = { email: lower(o.booked_by), name: booker?.name || o.booked_by, admin: booker?.role === 'admin' };
    if (o.kind === 'task') {
      const { addComment } = await import('../projects/tasks');
      await addComment(env, actor, o.ref, { body: line }, { source: 'meeting' });
      return true;
    }
    if (o.kind === 'request') {
      const { addComment, readable } = await import('../requests/tasks');
      const row = await readable(env as never, o.ref, actor);
      await addComment(env as never, row, actor, line, { source: 'board' });
      return true;
    }
    return false;
  } catch (err) {
    await env.DB.prepare('UPDATE hub_meeting_origins SET notes_posted = 0 WHERE meeting_id = ?').bind(meetingId).run().catch(() => undefined);
    throw err;
  }
}
