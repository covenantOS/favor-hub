// Calls to /api/onboarding. The Astro pages read the server's words and status, so these helpers keep both and throw one error type.
// A read goes through the same isomorphic path as every web page (the server asks through the relay with the visitor's cookie, so the
// privacy rules in functions/_lib/onboard apply unchanged); a change goes from the browser with the X-Hub-Request header.
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import { HUB_ORIGIN } from '../../lib/hub';

export class OnboardError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = '') {
    super(message);
    this.name = 'OnboardError';
    this.status = status;
    this.code = code;
  }
}

type Body = { ok?: boolean; message?: string; error?: string } & Record<string, unknown>;

async function run(url: string, init: RequestInit): Promise<Body> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new OnboardError('No connection. Check your internet and try again.');
  }
  const data = (await res.json().catch(() => null)) as Body | null;
  if (!res.ok || !data || data.ok === false) throw new OnboardError((data && data.message) || 'Something went wrong. Try again.', res.status, (data && data.error) || '');
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

/** A change from the browser. `path` is under /api/onboarding/. */
export function sendJson(path: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown): Promise<Body> {
  return run('/api/onboarding/' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Hub-Request': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
