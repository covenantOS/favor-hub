// A huddle is a meeting started from a channel. Its state for the channel bar, the pre-join sheet and the card is read from
// presence rows, never from the meeting status alone: a person counts as in the room only while their browser has sent a
// heartbeat in the last GONE_MS (20 seconds). A tab closed without Leave, a locked phone or a dropped network stops the
// heartbeat, so the count is right again within about 20 seconds without anyone pressing anything.
import type { Env } from '../http';
import { GONE_MS } from '../meet';

/** A huddle nobody has joined yet stays open this long, while the person who pressed Start a huddle is connecting. */
export const HUDDLE_GRACE_MS = 60_000;

export interface HuddlePerson { email: string; name: string }
export interface HuddleState {
  id: string;
  title: string;
  /** When the first person joined (ms), or 0 before anyone has. */
  startedAt: number;
  people: HuddlePerson[];
  live: boolean;
}
interface Row { id: string; title: string; status: string; started_at: string | null; created_at: string }

/** The people in a room right now: one entry per person, however many tabs or devices they have open. */
export async function peopleIn(env: Env, meetingId: string, now = Date.now()): Promise<HuddlePerson[]> {
  const r = await env.DB.prepare(
    'SELECT lower(email) AS email, MIN(name) AS name FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND waiting = 0 AND seen > ? GROUP BY lower(email) ORDER BY MIN(joined_at)'
  ).bind(meetingId, now - GONE_MS).all<HuddlePerson>().catch(() => ({ results: [] as HuddlePerson[] }));
  return r.results || [];
}

/** Live while someone is in the room, or in the first minute after Start a huddle before anyone has joined. */
export function isLive(m: Pick<Row, 'status' | 'started_at' | 'created_at'>, inRoom: number, now = Date.now()): boolean {
  if (m.status === 'ended' || m.status === 'cancelled') return false;
  if (inRoom > 0) return true;
  return !m.started_at && now - Date.parse(m.created_at || '') < HUDDLE_GRACE_MS;
}

/**
 * The channel's open huddles, newest first, each with who is in it and whether it is live. A channel has at most one live
 * huddle; the rest are rooms everyone left, which the caller ends.
 */
export async function huddlesOf(env: Env, channelId: string, now = Date.now()): Promise<HuddleState[]> {
  const rows = (await env.DB.prepare(
    `SELECT m.id, m.title, m.status, m.started_at, m.created_at FROM chat_meetings cm JOIN hub_meetings m ON m.id = cm.meeting_id
      WHERE cm.channel_id = ? AND m.status NOT IN ('ended', 'cancelled') ORDER BY m.created_at DESC LIMIT 5`
  ).bind(channelId).all<Row>().catch(() => ({ results: [] as Row[] }))).results || [];
  const out: HuddleState[] = [];
  for (const m of rows) {
    const people = await peopleIn(env, m.id, now);
    out.push({ id: m.id, title: m.title, startedAt: m.started_at ? Date.parse(m.started_at) || 0 : 0, people, live: isLive(m, people.length, now) });
  }
  return out;
}

/** The one live huddle in a channel, or null. */
export async function huddleOf(env: Env, channelId: string, now = Date.now()): Promise<HuddleState | null> {
  return (await huddlesOf(env, channelId, now)).find((h) => h.live) || null;
}
