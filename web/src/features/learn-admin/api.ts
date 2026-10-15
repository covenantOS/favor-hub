// Calls to the Learn routes for the manage and course editor pages. The Astro script kept the server's status and error code on its
// errors (a 403 says "Managing learning is for admins and HR"), so these helpers keep both. Reads go through the same isomorphic path as
// every web page: on the server through the relay with the visitor's own cookie, so the privacy rules apply unchanged.
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import { HUB_ORIGIN } from '../../lib/hub';

export class LearnError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = '') {
    super(message);
    this.name = 'LearnError';
    this.status = status;
    this.code = code;
  }
}

export type Body = { ok?: boolean; message?: string; error?: string } & Record<string, unknown>;

async function run(url: string, init: RequestInit): Promise<Body> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as Body | null;
  if (!res.ok || !data || data.ok === false) throw new LearnError((data && data.message) || 'Something went wrong. Try again.', res.status, (data && data.error) || '');
  return data;
}

/** A read from the browser or, on the server, through the relay with the visitor's cookie. Throws LearnError with the server's status. */
export const readJson = createIsomorphicFn()
  .server(async (path: string): Promise<Body> => {
    const { env } = await import('cloudflare:workers');
    const headers: Record<string, string> = { 'X-Hub-Request': '1', accept: 'application/json', 'X-Web-Key': (env as unknown as { WEB_KEY?: string }).WEB_KEY || '' };
    const cookie = getRequestHeader('cookie');
    if (cookie) headers.cookie = cookie;
    return run(HUB_ORIGIN + path, { headers, credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
  })
  .client((path: string): Promise<Body> => run(path, { headers: { 'X-Hub-Request': '1', accept: 'application/json' }, credentials: 'same-origin' }));

/** A change from the browser. The Astro page always sent a JSON body, even an empty one, and so does this. */
export function sendJson(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown = {}): Promise<Body> {
  return run(path, { method, credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** A browser-only read that never throws for the help library (a static file, not an /api route). */
export async function readHelpIndex(): Promise<unknown> {
  const res = await fetch('/help/search.json', { credentials: 'same-origin' });
  return res.json();
}
