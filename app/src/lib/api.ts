// The typed API client. Every call names the zod schema its answer must match (shared/schemas), so a server change that drops or
// renames a field fails here with the route's name, not as a blank card.
import type { ZodType } from 'zod';
import { takeEarly } from './early';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type Listener = () => void;
const afterWrite = new Set<Listener>();
/** Called after any successful non-GET /api call (the menu's counts may have moved). */
export function onApiWrite(fn: Listener): () => void {
  afterWrite.add(fn);
  return () => afterWrite.delete(fn);
}

export interface ApiInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

function toSignin(): never {
  const next = location.pathname + location.search;
  location.href = '/login/?next=' + encodeURIComponent(next);
  throw new ApiError('Sign in again.', 401, 'signin');
}

async function request(path: string, init: ApiInit = {}): Promise<unknown> {
  const method = init.method || 'GET';
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: init.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('You look to be offline. Try again when you are back.', 0, 'network');
  }
  if (res.status === 401) toSignin();
  const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;
  if (!res.ok || !data || data.ok === false) {
    throw new ApiError((data && data.message) || 'Something went wrong. Try again.', res.status, (data && data.error) || '');
  }
  if (method !== 'GET') afterWrite.forEach((f) => f());
  return data;
}

/** Fetch a route and check its answer against the schema. */
export async function api<T>(path: string, schema: ZodType<T>, init?: ApiInit): Promise<T> {
  let data: unknown = null;
  // The answer the page asked for before its scripts arrived, if there is one and it was good.
  if (!init || !init.method || init.method === 'GET') {
    const e = await takeEarly(path);
    if (e && (e as { ok?: boolean }).ok === true) data = e;
  }
  if (data === null) data = await request(path, init);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error('[api] ' + path + ' did not match its schema', parsed.error.issues);
    throw new ApiError('The answer from ' + path + ' was not what this page expects.', 200, 'shape');
  }
  return parsed.data;
}

/** A write that needs no checked answer beyond ok: true. */
export async function send(path: string, body?: unknown, method: ApiInit['method'] = 'POST'): Promise<Record<string, unknown>> {
  return (await request(path, { method, body: body ?? {} })) as Record<string, unknown>;
}
