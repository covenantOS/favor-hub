// Meetings started from a channel. The card in the channel is a reference to the meeting, so it reads live, ended or notes ready
// from the meeting itself. These two hooks run from the Meetings code when a meeting ends and when its notes are ready; each does
// nothing for a meeting that was not started from Chat.
import type { Env } from '../http';
import * as store from './db';
import { MEETINGS_ID } from './text';
import { hydrateAttachments } from './hydrate';
import { publish, type LiveEnv } from './live';

interface Link { channel_id: string; message_id: number; notes_posted: number }

async function linkOf(env: Env, meetingId: string): Promise<Link | null> {
  return env.DB.prepare('SELECT channel_id, message_id, notes_posted FROM chat_meetings WHERE meeting_id = ?').bind(meetingId).first<Link>().catch(() => null);
}

async function refreshCard(env: LiveEnv, link: Link): Promise<void> {
  const row = await store.getMessage(env, link.message_id);
  if (!row) return;
  const [msg] = await store.shape(env, [row], (a) => hydrateAttachments(env, a));
  await publish(env, await store.membersOf(env, link.channel_id), { type: 'edit', message: msg });
}

export async function chatMeetingEnded(env: Env, meetingId: string): Promise<void> {
  const link = await linkOf(env, meetingId);
  if (link) await refreshCard(env as LiveEnv, link);
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
  const lines = [`Notes are ready for ${m.title || 'the meeting'}.`, '', String(m.summary || '').slice(0, 700)];
  const actions = (notes.actions || []).filter((a) => a && a.text).slice(0, 6);
  if (actions.length) lines.push('', 'Action items', ...actions.map((a) => `- ${a.owner ? a.owner + ': ' : ''}${a.text}`));
  const body = lines.join('\n').trim();
  const posted = await store.post(env, {
    channel_id: link.channel_id, email: MEETINGS_ID, body, thread_id: link.message_id,
    attachments: [{ type: 'meeting', id: meetingId }],
  });
  await env.DB.prepare('UPDATE chat_meetings SET notes_posted = 1 WHERE meeting_id = ?').bind(meetingId).run();
  const [msg] = await store.shape(env, [posted.message], (a) => hydrateAttachments(env, a));
  const live = env as LiveEnv;
  await publish(live, posted.members, { type: 'message', message: msg });
  await refreshCard(live, link);
}
