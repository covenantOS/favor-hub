// Meetings started from a channel. The card in the channel is a reference to the meeting, so it reads live, ended or notes ready
// from the meeting itself. These two hooks run from the Meetings code when a meeting ends and when its notes are ready; each does
// nothing for a meeting that was not started from Chat.
import type { Env } from '../http';
import * as store from './db';
import { MEETINGS_ID } from './text';
import { hydrateAttachments } from './hydrate';
import { publish, type LiveEnv } from './live';
import { huddleOf } from './huddle';
import { emailsOf } from '../meet';

interface Link { channel_id: string; message_id: number; notes_posted: number }

async function linkOf(env: Env, meetingId: string): Promise<Link | null> {
  return env.DB.prepare('SELECT channel_id, message_id, notes_posted FROM chat_meetings WHERE meeting_id = ?').bind(meetingId).first<Link>().catch(() => null);
}

async function refreshCard(env: LiveEnv, link: Link): Promise<void> {
  const row = await store.getMessage(env, link.message_id);
  if (!row) return;
  const [msg] = await store.shape(env, [row], (a, ch) => hydrateAttachments(env, a, ch));
  await publish(env, await store.membersOf(env, link.channel_id), { type: 'edit', message: msg });
}

/** Tells the channel's members who is in its huddle now, so the huddle bar and the card update without a reload. */
async function pushHuddle(env: LiveEnv, link: Link): Promise<void> {
  await publish(env, await store.membersOf(env, link.channel_id), { type: 'huddle', channel_id: link.channel_id, huddle: await huddleOf(env, link.channel_id) });
}

export async function chatMeetingEnded(env: Env, meetingId: string): Promise<void> {
  const link = await linkOf(env, meetingId);
  if (!link) return;
  await refreshCard(env as LiveEnv, link);
  await pushHuddle(env as LiveEnv, link);
}

/** Someone joined or left a huddle started from Chat. Nothing happens for a meeting that was not. */
export async function chatHuddleChanged(env: Env, meetingId: string): Promise<void> {
  const link = await linkOf(env, meetingId);
  if (link) await pushHuddle(env as LiveEnv, link);
}

/** Every member of a private conversation may read this meeting's notes: host, made host, invited, present in the room, or a hub admin. */
export async function notesOpenToConversation(env: Env, meetingId: string, channelId: string): Promise<boolean> {
  const ch = await store.getChannel(env as never, channelId);
  if (!ch || ch.kind === 'public') return false;
  const m = await env.DB.prepare('SELECT host_email, cohosts, invitees FROM hub_meetings WHERE id = ?').bind(meetingId).first<{ host_email: string; cohosts: string; invitees: string }>();
  if (!m) return false;
  const ok = new Set([m.host_email.toLowerCase(), ...emailsOf(m.cohosts), ...emailsOf(m.invitees)]);
  const here = await env.DB.prepare(`SELECT DISTINCT lower(email) AS email FROM hub_meeting_presence WHERE meeting_id = ? AND role != 'guest'`).bind(meetingId).all<{ email: string }>().catch(() => ({ results: [] as Array<{ email: string }> }));
  for (const r of here.results || []) ok.add(r.email);
  const members = await env.DB.prepare(`SELECT lower(cm.email) AS email, COALESCE(u.role, 'staff') AS role FROM chat_members cm LEFT JOIN hub_users u ON lower(u.email) = lower(cm.email) WHERE cm.channel_id = ?`).bind(channelId).all<{ email: string; role: string }>();
  return (members.results || []).every((x) => x.role === 'admin' || ok.has(x.email));
}

/** The notes are ready: the card flips to "Notes ready" and a summary lands in the card's thread. */
export async function chatNotesReady(env: Env, meetingId: string): Promise<void> {
  const link = await linkOf(env, meetingId);
  if (!link || link.notes_posted) return;
  const m = await env.DB.prepare('SELECT title, summary, notes_json FROM hub_meetings WHERE id = ?').bind(meetingId).first<{ title: string; summary: string; notes_json: string }>();
  if (!m) return;
  const notes = (() => {
    try {
      return JSON.parse(m.notes_json || '{}') as { decisions?: string[]; actions?: Array<{ owner?: string; text?: string }> };
    } catch {
      return {};
    }
  })();
  const lines = [`Notes are ready for ${m.title || 'the meeting'}.`];
  // The summary and action items are the notes, so they go into the conversation only when everyone who can read it may read the
  // notes: a private conversation whose members are all on the meeting (host, invited, present) or admins. A public channel is
  // readable by all staff, so it gets the one line and the card, which opens the notes for the people allowed (privacy pass 2026-10-14).
  if (await notesOpenToConversation(env, meetingId, link.channel_id)) {
    lines.push('', String(m.summary || '').slice(0, 700));
    const actions = (notes.actions || []).filter((a) => a && a.text).slice(0, 6);
    if (actions.length) lines.push('', 'Action items', ...actions.map((a) => `- ${a.owner ? a.owner + ': ' : ''}${a.text}`));
  }
  const body = lines.join('\n').trim();
  const posted = await store.post(env, {
    channel_id: link.channel_id, email: MEETINGS_ID, body, thread_id: link.message_id,
    attachments: [{ type: 'meeting', id: meetingId }],
  });
  await env.DB.prepare('UPDATE chat_meetings SET notes_posted = 1 WHERE meeting_id = ?').bind(meetingId).run();
  const [msg] = await store.shape(env, [posted.message], (a, ch) => hydrateAttachments(env, a, ch));
  const live = env as LiveEnv;
  await publish(live, posted.members, { type: 'message', message: msg });
  await refreshCard(live, link);
}
