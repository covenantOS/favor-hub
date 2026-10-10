// Clips: shared helpers. Recording and managing clips is for hub admins; watching is for any signed-in
// staff member, or anyone with the link when the clip's share switch is on.
import { errorJson, type Env } from './http';
import { hubUserOf, type HubUser } from './session';

export const MAX_MS = 15 * 60 * 1000;
export const PART_BYTES = 8 * 1024 * 1024;
export const ID_RE = /^[0-9a-f]{32}$/;
export const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } as const;

export interface Clip {
  id: string;
  owner_email: string;
  owner_name: string;
  title: string;
  status: 'uploading' | 'ready';
  share: number;
  mime: string;
  upload_id: string | null;
  size_bytes: number;
  duration_ms: number;
  has_poster: number;
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

export const videoKey = (id: string) => `clips/${id}/video`;
export const posterKey = (id: string) => `clips/${id}/poster`;

export function extFor(mime: string): string {
  return /mp4/i.test(mime) ? 'mp4' : 'webm';
}

export function cleanMime(raw: unknown): string {
  const s = String(raw || '').toLowerCase();
  if (s.startsWith('video/mp4')) return 'video/mp4';
  return 'video/webm';
}

/** The signed-in admin, or the response that says why not. */
export function adminOrError(request: Request): { user: HubUser } | { res: Response } {
  const user = hubUserOf(request);
  if (!user) return { res: json401() };
  if (user.role !== 'admin') return { res: errorJson('forbidden', 'Recording clips is for hub admins.', 403) };
  return { user };
}

function json401(): Response {
  const res = errorJson('signin', 'Sign in with your Favor Google account first.', 401);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

/** A clip the signed-in admin owns, in any state. */
export async function ownClip(env: ClipsEnv, user: HubUser, id: string): Promise<Clip | null> {
  if (!ID_RE.test(id)) return null;
  return env.DB.prepare('SELECT * FROM hub_clips WHERE id = ? AND owner_email = ?').bind(id, user.email).first<Clip>();
}

/** May this request watch this clip? Share on opens it to everyone, otherwise a signed-in hub user. */
export function mayWatch(request: Request, clip: Clip): boolean {
  return clip.share === 1 || !!hubUserOf(request);
}

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
