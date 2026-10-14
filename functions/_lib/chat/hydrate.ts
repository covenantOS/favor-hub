// Clip and meeting cards are stored as references ({type, id}) and filled in from their own tables each time a message is read,
// so a card always shows the clip's current title or whether the meeting is live, ended, or has notes.
import type { Env } from '../http';
import type { Attachment } from './db';
import { GONE_MS } from '../meet';
import { isLive } from './huddle';
import { levelOf } from '../clips';
import { hydrateTaskCards } from './tasks';
import { hydratePTaskCards } from '../projects/links/chat'; // projects hook
import { hydratePlusCards } from './plus-cards';
import { meetingOpenHere, membersOf, type Member } from './cardaccess';

const mins = (ms: number) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const ET = 'America/New_York';
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: ET });
  if (key(d) === key(new Date())) return 'Today';
  if (key(d) === key(new Date(Date.now() - 864e5))) return 'Yesterday';
  return d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' });
}

interface ClipRow { id: string; title: string; summary: string; status: string; owner_name: string; duration_ms: number; has_poster: number; created_at: string; share?: number; staff_link?: number; access?: string | null }
interface MeetRow { id: string; title: string; status: string; started_at: string | null; ended_at: string | null; notes_status: string; summary: string; created_at: string; host_email: string; cohosts: string; invitees: string; access: string; post_channel: string }

/** channelId is the conversation the message sits in: a meeting or task card names its subject only where every member may open it (cardaccess.ts). */
export async function hydrateAttachments(env: Env, list: Attachment[], channelId?: string): Promise<Attachment[]> {
  let members: Member[] | null | undefined;
  const audience = async (): Promise<Member[] | null> => (members === undefined ? (members = await membersOf(env, channelId)) : members);
  // q3-tasks hook: request board cards ({type: 'task'}) are filled in by chat/tasks.ts.
  if (list.some((a) => a.type === 'task')) list = await hydrateTaskCards(env, list);
  // projects hook: project task cards ({type: 'ptask'}) are filled in by projects/links/chat.ts.
  if (list.some((a) => a.type === 'ptask')) list = await hydratePTaskCards(env, list, channelId, await audience());
  // Checklists, polls and the private scheduled and reminder notes (chat/plus-cards.ts).
  if (list.some((a) => a.type === 'checklist' || a.type === 'poll' || a.type === 'note')) list = await hydratePlusCards(env, list);
  // Voice notes carry their transcript: working while Whisper reads it, then the words (or none heard).
  const voiceIds = list.filter((a) => a.type === 'file' && a.voice === true && typeof a.id === 'string').map((a) => String(a.id));
  if (voiceIds.length) {
    const v = await env.DB.prepare(`SELECT file_id, status, transcript FROM chat_voice WHERE file_id IN (${voiceIds.map(() => '?').join(',')})`).bind(...voiceIds).all<{ file_id: string; status: string; transcript: string }>().catch(() => ({ results: [] as Array<{ file_id: string; status: string; transcript: string }> }));
    const by = new Map((v.results || []).map((x) => [x.file_id, x]));
    list = list.map((a) => {
      if (a.type !== 'file' || a.voice !== true) return a;
      const t = by.get(String(a.id));
      return t ? { ...a, transcript_status: t.status, transcript: t.transcript } : a;
    });
  }
  const clipIds = [...new Set(list.filter((a) => a.type === 'clip' && typeof a.id === 'string').map((a) => String(a.id)))];
  const meetIds = [...new Set(list.filter((a) => a.type === 'meeting' && typeof a.id === 'string').map((a) => String(a.id)))];
  const clips = new Map<string, ClipRow>();
  const meets = new Map<string, MeetRow>();
  const live = new Map<string, number>();
  const linked = new Set<string>();
  const named = new Set<string>();
  if (clipIds.length) {
    const r = await env.DB.prepare(`SELECT id, title, summary, status, owner_name, duration_ms, has_poster, created_at, share, staff_link, access FROM hub_clips WHERE id IN (${clipIds.map(() => '?').join(',')})`).bind(...clipIds).all<ClipRow>().catch(() => ({ results: [] as ClipRow[] }));
    for (const c of r.results || []) clips.set(c.id, c);
  }
  if (meetIds.length) {
    const cols = 'id, title, status, started_at, ended_at, notes_status, summary, created_at, host_email, cohosts, invitees, access, starts_at';
    const inList = meetIds.map(() => '?').join(',');
    // post_channel came with the notes post; an older table without it reads as no chosen channel.
    const r = await env.DB.prepare(`SELECT ${cols}, post_channel FROM hub_meetings WHERE id IN (${inList})`).bind(...meetIds).all<MeetRow>()
      .catch(() => env.DB.prepare(`SELECT ${cols}, '' AS post_channel FROM hub_meetings WHERE id IN (${inList})`).bind(...meetIds).all<MeetRow>())
      .catch(() => ({ results: [] as MeetRow[] }));
    for (const m of r.results || []) meets.set(m.id, m);
    const cutoff = Date.now() - GONE_MS;
    const p = await env.DB.prepare(`SELECT meeting_id, COUNT(DISTINCT lower(email)) AS n FROM hub_meeting_presence WHERE meeting_id IN (${meetIds.map(() => '?').join(',')}) AND left_at = 0 AND seen > ? AND removed = 0 AND waiting = 0 GROUP BY meeting_id`).bind(...meetIds, cutoff).all<{ meeting_id: string; n: number }>().catch(() => ({ results: [] as Array<{ meeting_id: string; n: number }> }));
    for (const x of p.results || []) live.set(x.meeting_id, x.n);
    if (channelId) {
      const l = await env.DB.prepare(`SELECT meeting_id FROM chat_meetings WHERE channel_id = ? AND meeting_id IN (${meetIds.map(() => '?').join(',')})`).bind(channelId, ...meetIds).all<{ meeting_id: string }>().catch(() => ({ results: [] as Array<{ meeting_id: string }> }));
      for (const x of l.results || []) linked.add(x.meeting_id);
    }
    const mem = await audience();
    for (const m of meets.values()) if (meetingOpenHere(m, mem, channelId, linked.has(m.id))) named.add(m.id);
  }
  return list.map((a) => {
    if (a.type === 'clip') {
      const c = clips.get(String(a.id));
      if (!c || (c.status !== 'ready' && c.status !== 'processing')) return { type: 'link', url: '#', host: 'Clip', title: 'This clip is no longer available' };
      return {
        type: 'clip', id: c.id, title: c.title || 'Untitled clip', summary: c.summary || '', duration: c.duration_ms ? mins(c.duration_ms) : '', by: c.owner_name, when: whenLabel(c.created_at),
        thumb: c.has_poster ? `/api/clips/${c.id}/poster` : '', url: `/c/${c.id}`,
        // Who can watch it, so the sender sees a note when the people in the conversation cannot open it (Clips sharing, 2026-10-14).
        level: levelOf(c),
      };
    }
    if (a.type === 'meeting') {
      const m = meets.get(String(a.id));
      if (!m) return { type: 'link', url: '#', host: 'Meeting', title: 'This meeting is no longer available' };
      // Live while someone is in the room (a heartbeat in the last 20 seconds), or in the first minute after Start a huddle
      // before anyone has joined. A room everyone left reads as ended at once, even before the meeting row is closed.
      const inRoom = live.get(m.id) || 0;
      // Booked for later (Find a time): scheduled until someone is in the room, up to an hour past its start.
      const at = (m as MeetRow & { starts_at?: string | null }).starts_at || null;
      const later = m.status === 'scheduled' && !inRoom && !m.started_at && !!at && Date.parse(at) > Date.now() - 60 * 60000;
      const ended = !later && !isLive(m, inRoom);
      if (later) {
        if (!named.has(m.id)) return { type: 'meeting', id: m.id, title: 'Private meeting', private: true, status: 'scheduled', starts_at: at, count: 0, url: `/meet/?m=${m.id}`, notes: false, notes_url: '', duration: '' };
        return { type: 'meeting', id: m.id, title: m.title || 'Meeting', status: 'scheduled', starts_at: at, count: 0, url: `/meet/?m=${m.id}`, room_url: `/meet/room/?m=${m.id}`, notes: false, notes_url: '', duration: '' };
      }
      // Someone in the conversation is not on this meeting: no title, no count of people, no notes flag.
      if (!named.has(m.id)) return { type: 'meeting', id: m.id, title: 'Private meeting', private: true, status: ended ? 'ended' : 'live', count: 0, url: `/meet/room/?m=${m.id}`, notes: false, notes_url: '', duration: '' };
      return {
        type: 'meeting', id: m.id, title: m.title || 'Meeting', status: ended ? 'ended' : 'live', count: ended ? 0 : inRoom,
        url: `/meet/room/?m=${m.id}`, notes: m.notes_status === 'ready', notes_url: `/meet/notes/?m=${m.id}`,
        duration: m.started_at && m.ended_at ? `${Math.max(1, Math.round((Date.parse(m.ended_at) - Date.parse(m.started_at)) / 60000))} min` : '',
      };
    }
    return a;
  });
}
