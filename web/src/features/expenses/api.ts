// Calls to the expense routes. The Astro pages read the error code the server sends ("signin", "not_on_list"), so these helpers keep it
// and throw one error type with the status and the code. Reads go through the same isomorphic path as every web page, so the server
// draws a read with the visitor's own cookie through the relay (functions/_lib/privacy applies unchanged).
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import { HUB_ORIGIN } from '../../lib/hub';

export class ExpenseError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = '') {
    super(message);
    this.name = 'ExpenseError';
    this.status = status;
    this.code = code;
  }
}

type Body = { ok?: boolean; message?: string; error?: string } & Record<string, unknown>;

async function run(url: string, init: RequestInit): Promise<Body> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as Body | null;
  if (!res.ok || !data || data.ok === false) throw new ExpenseError((data && data.message) || 'Request failed', res.status, (data && data.error) || '');
  return data;
}

/** A read from the browser or, on the server, through the relay with the visitor's cookie. Throws ExpenseError with the server's code. */
export const readJson = createIsomorphicFn()
  .server(async (path: string): Promise<Body> => {
    const { env } = await import('cloudflare:workers');
    const headers: Record<string, string> = { 'X-Hub-Request': '1', accept: 'application/json', 'X-Web-Key': (env as unknown as { WEB_KEY?: string }).WEB_KEY || '' };
    const cookie = getRequestHeader('cookie');
    if (cookie) headers.cookie = cookie;
    return run(HUB_ORIGIN + path, { headers, credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
  })
  .client((path: string): Promise<Body> => run(path, { headers: { 'X-Hub-Request': '1', accept: 'application/json' }, credentials: 'same-origin' }));

/** A change from the browser. */
export function sendJson(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<Body> {
  return run(path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Hub-Request': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Send a person whose session ended to sign-in and back, as the Astro pages do. Browser only. */
export function toSignin(): void {
  window.location.href = '/login/?next=' + encodeURIComponent(window.location.pathname + window.location.search);
}
