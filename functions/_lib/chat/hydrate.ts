// Clip and meeting cards are stored as references ({type, id}) and filled in from their own tables each time a message is read,
// so a card always shows the clip's current title or whether the meeting is live, ended, or has notes.
import type { Env } from '../http';
import type { Attachment } from './db';
import { hydrateTaskCards } from './tasks';

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

interface ClipRow { id: string; title: string; summary: string; status: string; owner_name: string; duration_ms: number; has_poster: number; created_at: string }
interface MeetRow { id: string; title: string; status: string; started_at: string | null; ended_at: string | null; notes_status: string; summary: string; created_at: string }

export async function hydrateAttachments(env: Env, list: Attachment[]): Promise<Attachment[]> {
  // q3-tasks hook: request board cards ({type: 'task'}) are filled in by chat/tasks.ts.
  if (list.some((a) => a.type === 'task')) list = await hydrateTaskCards(env, list);
  const clipIds = [...new Set(list.filter((a) => a.type === 'clip' && typeof a.id === 'string').map((a) => String(a.id)))];
  const meetIds = [...new Set(list.filter((a) => a.type === 'meeting' && typeof a.id === 'string').map((a) => String(a.id)))];
  const clips = new Map<string, ClipRow>();
  const meets = new Map<string, MeetRow>();
  const live = new Map<string, number>();
  if (clipIds.length) {
    const r = await env.DB.prepare(`SELECT id, title, summary, status, owner_name, duration_ms, has_poster, created_at FROM hub_clips WHERE id IN (${clipIds.map(() => '?').join(',')})`).bind(...clipIds).all<ClipRow>().catch(() => ({ results: [] as ClipRow[] }));
    for (const c of r.results || []) clips.set(c.id, c);
  }
  if (meetIds.length) {
    const r = await env.DB.prepare(`SELECT id, title, status, started_at, ended_at, notes_status, summary, created_at FROM hub_meetings WHERE id IN (${meetIds.map(() => '?').join(',')})`).bind(...meetIds).all<MeetRow>().catch(() => ({ results: [] as MeetRow[] }));
    for (const m of r.results || []) meets.set(m.id, m);
    const cutoff = Date.now() - 20_000;
    const p = await env.DB.prepare(`SELECT meeting_id, COUNT(*) AS n FROM hub_meeting_presence WHERE meeting_id IN (${meetIds.map(() => '?').join(',')}) AND left_at = 0 AND seen > ? AND removed = 0 AND waiting = 0 GROUP BY meeting_id`).bind(...meetIds, cutoff).all<{ meeting_id: string; n: number }>().catch(() => ({ results: [] as Array<{ meeting_id: string; n: number }> }));
    for (const x of p.results || []) live.set(x.meeting_id, x.n);
  }
  return list.map((a) => {
    if (a.type === 'clip') {
      const c = clips.get(String(a.id));
      if (!c || (c.status !== 'ready' && c.status !== 'processing')) return { type: 'link', url: '#', host: 'Clip', title: 'This clip is no longer available' };
      return {
        type: 'clip', id: c.id, title: c.title || 'Untitled clip', summary: c.summary || '', duration: c.duration_ms ? mins(c.duration_ms) : '', by: c.owner_name, when: whenLabel(c.created_at),
        thumb: c.has_poster ? `/api/clips/${c.id}/poster` : '', url: `/c/${c.id}`,
      };
    }
    if (a.type === 'meeting') {
      const m = meets.get(String(a.id));
      if (!m) return { type: 'link', url: '#', host: 'Meeting', title: 'This meeting is no longer available' };
      // Live while someone is in the room, or for the first ten minutes after the button was pressed. A room nobody is in
      // after that reads as ended, even before the meeting is closed.
      const inRoom = live.get(m.id) || 0;
      const fresh = Date.now() - Date.parse(m.created_at || '') < 10 * 60_000;
      const ended = m.status === 'ended' || m.status === 'cancelled' || (!inRoom && !fresh);
      return {
        type: 'meeting', id: m.id, title: m.title || 'Meeting', status: ended ? 'ended' : 'live', count: ended ? 0 : live.get(m.id) || 0,
        url: `/meet/room/?m=${m.id}`, notes: m.notes_status === 'ready', notes_url: `/meet/notes/?m=${m.id}`,
        duration: m.started_at && m.ended_at ? `${Math.max(1, Math.round((Date.parse(m.ended_at) - Date.parse(m.started_at)) / 60000))} min` : '',
      };
    }
    return a;
  });
}
