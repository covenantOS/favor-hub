// Calls to the Learn and Practice routes. A read goes through the same isomorphic path as every web page (the server reads through the
// relay with the visitor's cookie, so the privacy rules in functions/ apply unchanged); a change is a plain same-origin fetch with
// the X-Hub-Request header. Both keep the status and the server's error code so a page can say why.
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import { HUB_ORIGIN } from '../../../lib/hub';

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
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new LearnError('No connection. Check your internet and try again.', 0, 'offline');
  }
  const data = (await res.json().catch(() => null)) as Body | null;
  if (!res.ok || !data || data.ok === false) throw new LearnError((data && data.message) || 'Something went wrong. Try again.', res.status, (data && data.error) || '');
  return data;
}

/** A read from the browser or, on the server, through the relay with the visitor's cookie. */
export const readJson = createIsomorphicFn()
  .server(async (path: string): Promise<Body> => {
    const { env } = await import('cloudflare:workers');
    const headers: Record<string, string> = { 'X-Hub-Request': '1', accept: 'application/json', 'X-Web-Key': (env as unknown as { WEB_KEY?: string }).WEB_KEY || '' };
    const cookie = getRequestHeader('cookie');
    if (cookie) headers.cookie = cookie;
    return run(HUB_ORIGIN + path, { headers, credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
  })
  .client((path: string): Promise<Body> => run(path, { headers: { 'X-Hub-Request': '1', accept: 'application/json' }, credentials: 'same-origin' }));

/** A change from the browser. keepalive lets a save finish while the page is closing. */
export function sendJson(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, keepalive = false): Promise<Body> {
  return run(path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Hub-Request': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(keepalive ? { keepalive: true } : {}),
  });
}

/** What a page that could not read says, by status (the words My learning has always used). */
export function failureTitle(status: number): string {
  return status === 404 ? 'That page is gone' : status === 403 ? 'Not open to you yet' : 'That did not load';
}
