// Who a card in a conversation may describe. A meeting or task card is drawn once for everyone who reads the conversation (and
// sent the same way over the live socket), so it names the meeting or task only when every member of the conversation may open
// it. Otherwise the card reads "Private meeting" or "Private task" and keeps its link: the room and the task page still check
// each reader. Privacy pass 2026-10-14: before this, any member of a channel saw the title of a private meeting linked there.
import type { Env } from '../http';
import { emailsOf } from '../meet';

export interface Member { email: string; role: string }

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** The people in a conversation and their hub role (admin, staff or field; staff when the hub has no row for them). */
export async function membersOf(env: Pick<Env, 'DB'>, channelId: string | undefined): Promise<Member[] | null> {
  if (!channelId) return null;
  const r = await env.DB.prepare(
    `SELECT lower(cm.email) AS email, COALESCE(u.role, 'staff') AS role FROM chat_members cm LEFT JOIN hub_users u ON lower(u.email) = lower(cm.email) WHERE cm.channel_id = ?`
  ).bind(channelId).all<Member>().catch(() => null);
  return r ? r.results || [] : null;
}

export interface MeetingFacts { id: string; host_email: string; cohosts: string; invitees: string; access: string; post_channel?: string }

/**
 * True when every member of the conversation may see this meeting: they host it, were invited, or are an admin, or the meeting
 * was booked open to all staff and the member is staff (a guest link closes that). A meeting started from this conversation
 * (a huddle) or whose host chose it for the notes post belongs to the conversation and is always named there.
 */
export function meetingOpenHere(m: MeetingFacts, members: Member[] | null, channelId: string | undefined, linkedHere: boolean): boolean {
  if (channelId && (linkedHere || (m.post_channel && lower(m.post_channel) === lower(channelId)))) return true;
  if (!members) return false;
  const roster = new Set([lower(m.host_email), ...emailsOf(m.cohosts), ...emailsOf(m.invitees)]);
  return members.every((p) => p.role === 'admin' || roster.has(p.email) || (m.access === 'staff' && p.role !== 'field'));
}

export interface TaskFacts { id: string; project_id: string | null; owner_email: string | null }

/**
 * True when every member of the conversation may see this task: a task with no project (it was made from Chat), a task in a
 * project open to all staff (field staff never use Projects), a task in the project's own channel, or a members-only project's
 * task when each member is in the project, on the task or an admin.
 */
export async function taskOpenHere(env: Pick<Env, 'DB'>, t: TaskFacts, members: Member[] | null, channelId: string | undefined): Promise<boolean> {
  if (!t.project_id) return true;
  const p = await env.DB.prepare('SELECT visibility, lead_email, chat_channel_id FROM hub_projects WHERE id = ?').bind(t.project_id).first<{ visibility: string; lead_email: string; chat_channel_id: string | null }>().catch(() => null);
  if (!p) return false;
  if (channelId && p.chat_channel_id && p.chat_channel_id === channelId) return true;
  if (!members) return false;
  if (p.visibility === 'staff') return members.every((m) => m.role !== 'field');
  const inProject = new Set(((await env.DB.prepare('SELECT lower(email) AS email FROM hub_project_members WHERE project_id = ?').bind(t.project_id).all<{ email: string }>().catch(() => null))?.results || []).map((r) => r.email));
  inProject.add(lower(p.lead_email));
  const onTask = new Set(((await env.DB.prepare('SELECT lower(email) AS email FROM hub_task_people WHERE task_id = ?').bind(t.id).all<{ email: string }>().catch(() => null))?.results || []).map((r) => r.email));
  onTask.add(lower(t.owner_email));
  return members.every((m) => m.role === 'admin' || inProject.has(m.email) || onTask.has(m.email));
}
