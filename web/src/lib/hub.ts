// One read helper for both sides. On the server it reads the hub's own /api over HTTPS with the visitor's cookie, so every privacy
// rule in functions/ applies unchanged; in the browser it is the app's usual same-origin read with the X-Hub-Request header.
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';

export const HUB_ORIGIN = 'https://dash.favorintl.org';

export class HubReadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HubReadError';
    this.status = status;
  }
}

async function read(url: string, cookie: string | undefined): Promise<unknown> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1', accept: 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(url, { headers, credentials: 'same-origin' });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || !data || data.ok === false) throw new HubReadError((data && data.message) || 'Something went wrong. Try again.', res.status);
  return data;
}

export const hubGet = createIsomorphicFn()
  .server((path: string) => read(HUB_ORIGIN + path, getRequestHeader('cookie')))
  .client((path: string) => read(path, undefined));
