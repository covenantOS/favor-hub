// Clips: shared helpers. Every signed-in hub user records clips and manages their own; an admin can also see every clip
// and delete any of them. Watching is for any signed-in staff member with the link, or anyone with the link when the clip's
// share switch is on (not when the person who made it has been blocked from the hub).
import { errorJson, type Env } from './http';
import { hubUserOf, type HubUser } from './session';

export const MAX_MS = 45 * 60 * 1000;
/** Storage each person may keep in Clips. The library warns at 80% and names the oldest clips nobody watched. */
export const CAP_BYTES = 10 * 1024 ** 3;
export const WARN_FRACTION = 0.8;
export const PART_BYTES = 8 * 1024 * 1024;
export const MAX_PARTS = 400;
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
export const ID_RE = /^[0-9a-f]{32}$/;
export const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } as const;
/** An upload nobody finished is cleaned up after this long. */
export const STALE_UPLOAD_MS = 24 * 3_600_000;

export type ClipStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export interface Clip {
  id: string;
  owner_email: string;
  owner_name: string;
  title: string;
  summary: string;
  status: ClipStatus;
  share: number;
  mime: string;
  kind: string;
  upload_id: string | null;
  parts: string;
  audio_segments: string;
  transcript: string;
  words: string;
  chapters: string;
  edits: string;
  help_draft: string;
  translations: string;
  error: string | null;
  title_auto: number;
  proc_at: string | null;
  size_bytes: number;
  duration_ms: number;
  has_poster: number;
  owner_team: string;
  seen: string;
  views: number;
  created_at: string;
  updated_at: string;
}

export interface ClipsEnv extends Env {
  CLIPS: R2Bucket;
}

export function clipId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function rowId(prefix: string): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const videoKey = (id: string) => `clips/${id}/video`;
export const posterKey = (id: string) => `clips/${id}/poster`;
export const tailPrefix = (id: string) => `clips/${id}/tail/`;
export const tailKey = (id: string, off: number) => `${tailPrefix(id)}${String(off).padStart(12, '0')}`;
export const framesPrefix = (id: string) => `clips/${id}/frames/`;
export const frameKey = (id: string, tMs: number) => `${framesPrefix(id)}${String(tMs).padStart(9, '0')}.jpg`;
export const audioPrefix = (id: string) => `clips/${id}/audio/`;
export const sliceTextKey = (id: string, n: number) => `clips/${id}/audio/${n}.json`;

export function extFor(mime: string): string {
  return /mp4/i.test(mime) ? 'mp4' : /quicktime/i.test(mime) ? 'mov' : 'webm';
}

export function cleanMime(raw: unknown): string {
  const s = String(raw || '').toLowerCase();
  if (s.startsWith('video/mp4')) return 'video/mp4';
  if (s.startsWith('video/quicktime')) return 'video/quicktime';
  return 'video/webm';
}

export function cleanKind(raw: unknown): string {
  const s = String(raw || '');
  return s === 'camera' || s === 'upload' ? s : 'screen';
}

/** JSON column to a value, or the fallback when the text is empty or broken. */
export function J<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** The signed-in admin, or the response that says why not. */
export function adminOrError(request: Request): { user: HubUser } | { res: Response } {
  const user = hubUserOf(request);
  if (!user) return { res: json401() };
  if (user.role !== 'admin') return { res: errorJson('forbidden', 'Recording clips is for hub admins.', 403) };
  return { user };
}

/** Any signed-in staff member, or the response that says why not. */
export function staffOrError(request: Request): { user: HubUser } | { res: Response } {
  const user = hubUserOf(request);
  if (!user) return { res: json401() };
  return { user };
}

function json401(): Response {
  const res = errorJson('signin', 'Sign in with your Favor Google account first.', 401);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

/** A clip the signed-in admin owns, in any state. Uploading is the owner's alone. */
export async function ownClip(env: ClipsEnv, user: HubUser, id: string): Promise<Clip | null> {
  if (!ID_RE.test(id)) return null;
  return env.DB.prepare('SELECT * FROM hub_clips WHERE id = ? AND owner_email = ?').bind(id, user.email).first<Clip>();
}

/**
 * A clip the signed-in person may manage once it is saved: rename, edit, share, write again. Only the person who made it.
 * `allowAdmin` also lets a hub admin through (deleting, to clear space), but never editing someone else's clip.
 */
export async function manageClip(env: ClipsEnv, user: HubUser, id: string, opts: { allowAdmin?: boolean } = {}): Promise<Clip | null> {
  if (!ID_RE.test(id)) return null;
  const clip = await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>();
  if (!clip) return null;
  const mine = clip.owner_email === user.email;
  if (!mine && !(opts.allowAdmin && user.role === 'admin')) return null;
  if (clip.status === 'uploading' && !mine) return null;
  return clip;
}

/**
 * May this request watch this clip? A signed-in hub user may. Anyone else needs the share switch on, and the person who made
 * the clip must still have access to the hub (a blocked person's links stop working for people outside the hub).
 */
export async function canWatch(env: ClipsEnv, request: Request, clip: Pick<Clip, 'share' | 'owner_email'>): Promise<boolean> {
  if (hubUserOf(request)) return true;
  if (clip.share !== 1) return false;
  const row = await env.DB.prepare('SELECT blocked FROM hub_users WHERE email = ?').bind(clip.owner_email).first<{ blocked: number }>().catch(() => null);
  return !(row && row.blocked);
}

export const isWatchable = (c: Pick<Clip, 'status'>) => c.status === 'ready' || c.status === 'processing';

/** Parses a Range header against the object's size. null means no range, 'bad' means unsatisfiable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'bad' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n <= 0) return 'bad';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'bad';
  return { start, end };
}

export interface PartRec { n: number; etag: string; size: number }
export interface AudioSeg { n: number; start: number; size: number; ext: string }

/** What a viewer may see of a clip. A signed-out viewer through the share link gets the video, its words and nothing else. */
export function clipView(c: Clip) {
  const duration = c.duration_ms / 1000;
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    status: c.status,
    kind: c.kind,
    mime: c.mime,
    duration,
    size: c.size_bytes,
    hasPoster: c.has_poster === 1,
    share: c.share === 1,
    ownerName: c.owner_name,
    createdAt: c.created_at,
    chapters: J<unknown[]>(c.chapters, []),
    transcript: J<unknown[]>(c.transcript, []),
    words: J<unknown[]>(c.words, []),
    translations: J<Record<string, string[]>>(c.translations, {}),
    edits: J<Record<string, unknown>>(c.edits, {}),
    error: c.error,
  };
}

/** Every R2 object a clip owns: the video, poster, sound slices, their cached words and tail pieces. Returns how many went. */
export async function purgeClip(env: ClipsEnv, id: string): Promise<number> {
  let gone = 0;
  for (let cursor: string | undefined; ; ) {
    const page = await env.CLIPS.list({ prefix: `clips/${id}/`, cursor, limit: 500 });
    if (page.objects.length) {
      await env.CLIPS.delete(page.objects.map((o) => o.key));
      gone += page.objects.length;
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return gone;
}

/** What a person's clips take up, and the oldest ones nobody has watched (offered for deletion once they pass 80%). */
export async function usageOf(env: ClipsEnv, email: string) {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS used, COUNT(*) AS clips FROM hub_clips WHERE owner_email = ? AND status != 'failed'").bind(email).first<{ used: number; clips: number }>();
  const used = Number(row?.used || 0);
  const pct = Math.min(100, Math.round((used / CAP_BYTES) * 100));
  const warn = used >= CAP_BYTES * WARN_FRACTION;
  let oldest: Array<{ id: string; title: string; created_at: string; size_bytes: number }> = [];
  if (warn) {
    const r = await env.DB.prepare("SELECT id, title, created_at, size_bytes FROM hub_clips WHERE owner_email = ? AND status = 'ready' AND views = 0 ORDER BY created_at ASC LIMIT 5").bind(email).all<{ id: string; title: string; created_at: string; size_bytes: number }>();
    oldest = r.results || [];
  }
  return { used, cap: CAP_BYTES, pct, warn, full: used >= CAP_BYTES, clips: Number(row?.clips || 0), oldestUnwatched: oldest };
}

const TEAM_LABEL: Record<string, string> = {
  support: 'Support',
  rdd: 'RDD',
  partner_care: 'Partner Care',
  church: 'Church Engagement',
  grants: 'Grants',
  admin: 'Admin',
  exec: 'Executive',
  pc: 'Partner Care',
  ce: 'Church Engagement',
  marketing: 'Marketing',
};

/** The team a person belongs to, from the hub's staff table (the Work Center's roster). Empty when the hub does not know. */
export async function teamOf(env: ClipsEnv, email: string): Promise<string> {
  const row = await env.DB.prepare('SELECT team FROM act_staff WHERE email = ? AND active = 1').bind(email.toLowerCase()).first<{ team: string }>().catch(() => null);
  return row ? TEAM_LABEL[row.team] || row.team : '';
}
