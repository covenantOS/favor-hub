// One read helper for both sides. On the server it reads the hub's own /api over HTTPS with the visitor's cookie, so every privacy
// rule in functions/ applies unchanged; in the browser it is the app's usual same-origin read with the X-Hub-Request header.
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';

// The Worker cannot fetch the Pages project that called it (Cloudflare answers that loop with 522), so server reads go through the
// key-guarded favoros-relay Worker (workers/favoros-relay), which forwards them to dash.favorintl.org with the visitor's cookie.
export const HUB_ORIGIN = 'https://favoros-relay.marketing-6e9.workers.dev';

export class HubReadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HubReadError';
    this.status = status;
  }
}

async function read(url: string, cookie: string | undefined, key?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1', accept: 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (key) headers['X-Web-Key'] = key;
  // A server read that hangs must not hold the page: after 8 s it fails, its Suspense boundary is drawn in the browser instead.
  const res = await fetch(url, { headers, credentials: 'same-origin', ...(typeof window === 'undefined' ? { signal: AbortSignal.timeout(8000) } : {}) });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || !data || data.ok === false) throw new HubReadError((data && data.message) || 'Something went wrong. Try again.', res.status);
  return data;
}

export const hubGet = createIsomorphicFn()
  .server(async (path: string) => {
    const { env } = await import('cloudflare:workers');
    return read(HUB_ORIGIN + path, getRequestHeader('cookie'), (env as unknown as { WEB_KEY?: string }).WEB_KEY);
  })
  .client((path: string) => read(path, undefined));
