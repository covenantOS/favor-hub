export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  ADMIN_PASSWORD?: string;
  AGENT_API_KEY?: string;
}

export const SURFACES = ['website', 'portal', 'dashboard', 'app'] as const;
export type Surface = (typeof SURFACES)[number];

export const STATUSES = ['inbox', 'approved', 'in_progress', 'done', 'declined'] as const;
export type Status = (typeof STATUSES)[number];

export const REPOS: Record<Surface, { repo: string; branch: string; path: string }> = {
  website: { repo: 'Favor-International/favor-astro', branch: 'main', path: 'C:\\Users\\Willb\\Claude\\favor-astro' },
  portal: { repo: 'Favor-International/favor-portal', branch: 'feature/blackbaud-giving-history', path: 'C:\\Users\\Willb\\Claude\\favor-portal' },
  dashboard: { repo: 'covenantOS/favor-hub', branch: 'main', path: 'C:\\Users\\Willb\\Claude\\favor\\site' },
  app: { repo: 'Favor-International/favor-marketing', branch: 'main', path: 'C:\\Users\\Willb\\Claude\\favor-marketing' },
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function errorJson(code: string, message: string, status = 400): Response {
  return json({ ok: false, error: code, message }, status);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix = 'req'): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function asTrimmed(value: unknown, field: string, maxLen: number, required = true): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s && required) throw new HttpError(400, 'missing_field', `${field} is required`);
  return s.slice(0, maxLen);
}

export function asSurface(value: unknown): Surface {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : 'website';
  if ((SURFACES as readonly string[]).includes(s)) return s as Surface;
  throw new HttpError(400, 'bad_surface', 'Surface must be website, portal, dashboard, or app');
}

export function asStatus(value: unknown): Status {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if ((STATUSES as readonly string[]).includes(s)) return s as Status;
  throw new HttpError(400, 'bad_status', 'Unknown status');
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '0.0.0.0';
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export class HttpError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function handleError(err: unknown): Response {
  if (err instanceof HttpError) return errorJson(err.code, err.message, err.status);
  console.error('[requests] unexpected', err);
  return errorJson('internal', 'Something went wrong on our side.', 500);
}
