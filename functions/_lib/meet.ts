// Meetings: shared helpers. Rooms run on the raw Cloudflare Realtime SFU (Marketing account). This server holds the
// app secret and the TURN key, hands each person a session, checks every SFU call against the room it belongs to,
// and keeps the roster, chat and host commands in D1. Admin only until the release switch says otherwise.
import { HttpError, type Env } from './http';
import { hubUserOf, type HubUser } from './session';

export interface MeetEnv extends Env {
  SFU_APP_ID?: string;
  SFU_APP_SECRET?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
  /** Local tests only: skips the SFU and returns made-up sessions. Never set on the live site. */
  MEET_FAKE_SFU?: string;
  /** "admin" (default) opens meetings to admins only; "staff" opens them to every signed-in person. */
  MEET_RELEASE?: string;
  CLIPS: R2Bucket;
}

export const SFU = 'https://rtc.live.cloudflare.com/v1';
export const ID_RE = /^[0-9a-f]{24}$/;
export const PID_RE = /^[0-9a-f]{12}$/;
/** A person who has not synced for this long counts as gone. */
export const GONE_MS = 20_000;
/** The recorder is stale when its last chunk is older than this. */
export const REC_STALE_MS = 3_000;
export const MAX_PEOPLE = 60;

export const hex = (bytes: number): string => {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export interface Meeting {
  id: string;
  title: string;
  agenda: string;
  host_email: string;
  host_name: string;
  cohosts: string;
  starts_at: string | null;
  ends_at: string | null;
  duration_min: number;
  rec_mode: 'off' | 'notes' | 'video';
  access: 'invited' | 'staff' | 'guests';
  invitees: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  locked: number;
  spot_pid: string;
  share_policy: 'all' | 'hosts';
  repeat: string;
  series_id: string;
  calendar_event_id: string;
  backup_link: string;
  remind: number;
  rec_state: string;
  drive_file_id: string;
  drive_folder: string;
  notes_status: string;
  summary: string;
  notes_json: string;
  transcript: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface Presence {
  meeting_id: string;
  pid: string;
  email: string;
  name: string;
  role: 'host' | 'cohost' | 'staff' | 'guest';
  session_id: string;
  tracks: string;
  mic: number;
  cam: number;
  hand: number;
  sharing: number;
  can_share: number;
  lvl: number;
  speak_at: number;
  waiting: number;
  removed: number;
  joined_at: number;
  seen: number;
  left_at: number;
}

/** Who may use meetings now. Admin only until MEET_RELEASE is "staff". */
export function meetUser(request: Request, env: MeetEnv): HubUser {
  const user = hubUserOf(request);
  if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const open = (env.MEET_RELEASE || 'admin').toLowerCase() === 'staff';
  if (!open && user.role !== 'admin') throw new HttpError(404, 'not_found', 'Not found.');
  return user;
}

export const emailsOf = (json: string): string[] => {
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.map((x) => String(typeof x === 'string' ? x : x?.email || '').toLowerCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

export function isHost(m: Meeting, email: string): boolean {
  const e = email.toLowerCase();
  return m.host_email.toLowerCase() === e || emailsOf(m.cohosts).includes(e);
}

export function mayJoin(m: Meeting, user: HubUser): boolean {
  if (m.status === 'cancelled') return false;
  if (user.role === 'admin') return true;
  if (isHost(m, user.email)) return true;
  if (m.access === 'staff' || m.access === 'guests') return true;
  return emailsOf(m.invitees).includes(user.email.toLowerCase());
}

export async function getMeeting(env: MeetEnv, id: string): Promise<Meeting> {
  if (!ID_RE.test(id)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const m = await env.DB.prepare('SELECT * FROM hub_meetings WHERE id = ?').bind(id).first<Meeting>();
  if (!m) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  return m;
}

export async function getPresence(env: MeetEnv, meetingId: string, pid: string, email: string): Promise<Presence> {
  if (!PID_RE.test(pid)) throw new HttpError(400, 'bad_pid', 'Rejoin the meeting.');
  const p = await env.DB.prepare('SELECT * FROM hub_meeting_presence WHERE meeting_id = ? AND pid = ?').bind(meetingId, pid).first<Presence>();
  if (!p || p.email.toLowerCase() !== email.toLowerCase()) throw new HttpError(403, 'not_in_meeting', 'You are not in this meeting. Rejoin it.');
  if (p.removed) throw new HttpError(403, 'removed', 'The host removed you from this meeting.');
  return p;
}

// ---------------------------------------------------------------- SFU

export async function sfuCall(env: MeetEnv, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (env.MEET_FAKE_SFU === '1') return fakeSfu(path, body);
  if (!env.SFU_APP_ID || !env.SFU_APP_SECRET) throw new HttpError(503, 'sfu_missing', 'Meetings are not set up yet.');
  const r = await fetch(`${SFU}/apps/${env.SFU_APP_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.SFU_APP_SECRET}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(text);
  } catch {
    /* leave empty */
  }
  if (!r.ok) throw new HttpError(502, 'sfu_error', 'The meeting service did not answer. Try again.');
  return j;
}

function fakeSfu(path: string, body: unknown): Record<string, unknown> {
  if (path.endsWith('/sessions/new')) return { sessionId: hex(16) };
  return { requiresImmediateRenegotiation: false, tracks: [], body };
}

export async function iceServers(env: MeetEnv): Promise<unknown[]> {
  if (env.MEET_FAKE_SFU === '1') return [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  const r = await fetch(`${SFU}/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: 4 * 3600 }),
  });
  if (!r.ok) return [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  const j = (await r.json()) as { iceServers?: unknown[] };
  // Port 53 times out in browsers; the list is otherwise passed on as Cloudflare issued it.
  return (j.iceServers || []).map((s) => {
    const o = s as { urls?: string[] };
    return o.urls ? { ...o, urls: o.urls.filter((u) => !/:53(\?|$)/.test(u)) } : s;
  });
}

export const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.trim().slice(0, max) : '');
