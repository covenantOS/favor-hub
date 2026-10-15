// Writes and browser reads for the Work Center. Same calls as public/js/work.js: X-Hub-Request, a sign-in redirect on 401, the answer's
// message on a refusal. Reads for the lists go through the queries in queries.ts (hubGet); these run from events and effects only.

export class WcError extends Error {
  data: Record<string, unknown>;
  status: number;
  constructor(message: string, data: Record<string, unknown>, status: number) {
    super(message);
    this.name = 'WcError';
    this.data = data;
    this.status = status;
  }
}

/** The ?as= address an admin used to see another person's Work Center, read when a call is made. */
export const asParam = (): string => (typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('as') || '');

export async function wcApi<T = Record<string, unknown>>(path: string, opts: RequestInit & { body?: string } = {}): Promise<T> {
  const as = asParam();
  const url = as ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(as) : path;
  const headers: Record<string, string> = { 'X-Hub-Request': '1', ...((opts.headers as Record<string, string>) || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { credentials: 'same-origin', ...opts, headers });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && data.error === 'signin') {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    throw new WcError('Sign in again.', data, 401);
  }
  if (!res.ok || data.ok === false) throw new WcError((data.message as string) || 'Something went wrong. Try again.', data, res.status);
  return data as T;
}
export const wcPost = <T = Record<string, unknown>>(path: string, body?: unknown) => wcApi<T>(path, { method: 'POST', body: JSON.stringify(body || {}) });
export const wcPatch = <T = Record<string, unknown>>(path: string, body?: unknown) => wcApi<T>(path, { method: 'PATCH', body: JSON.stringify(body || {}) });
export const wcPut = <T = Record<string, unknown>>(path: string, body?: unknown) => wcApi<T>(path, { method: 'PUT', body: JSON.stringify(body || {}) });
export const wcDelete = <T = Record<string, unknown>>(path: string) => wcApi<T>(path, { method: 'DELETE' });

/** A multipart post (file uploads): no JSON header. */
export async function wcForm<T = Record<string, unknown>>(path: string, form: FormData): Promise<T> {
  const as = asParam();
  const res = await fetch(path + (as ? (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(as) : ''), { method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || out.ok === false) throw new WcError((out.message as string) || 'Something went wrong. Try again.', out, res.status);
  return out as T;
}

export const reqId = (): string => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
