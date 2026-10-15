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

async function read(url: string, cookie: string | undefined, key?: string, loose = false): Promise<unknown> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1', accept: 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (key) headers['X-Web-Key'] = key;
  // A server read that hangs must not hold the page: after 8 s it fails, its Suspense boundary is drawn in the browser instead.
  const res = await fetch(url, { headers, credentials: 'same-origin', ...(typeof window === 'undefined' ? { signal: AbortSignal.timeout(8000) } : {}) });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  // A route whose answer carries ok:false with a 200 as a plain fact (the booking status of a person with no calendar) reads loose.
  if (!res.ok || !data || (data.ok === false && !loose)) throw new HubReadError((data && data.message) || 'Something went wrong. Try again.', res.status);
  return data;
}

// The menu answer is asked for by every page, and it is the slowest read (about 0.4 s through the relay), so the frame waited on it and the
// top bar arrived after the page. This Worker keeps the last answer for each signed-in visitor for 20 seconds, keyed by their own session
// cookie, so the next page they open draws its frame at once. It holds the parsed answer (never the promise: a promise made in one request
// cannot be awaited in another), only in this isolate's memory, only for the cookie that fetched it. The browser asks again after 20 s
// (staleTime) and every write path checks access on the server, so a role change shows within one refresh.
const NAV_TTL_MS = 20_000;
const NAV_MAX = 300;
const navKept = new Map<string, { at: number; data: unknown }>();

/** Like hubGet, but an answer with ok:false and a good status comes back as data instead of an error. */
export const hubGetLoose = createIsomorphicFn()
  .server(async (path: string) => {
    const { env } = await import('cloudflare:workers');
    return read(HUB_ORIGIN + path, getRequestHeader('cookie'), (env as unknown as { WEB_KEY?: string }).WEB_KEY, true);
  })
  .client((path: string) => read(path, undefined, undefined, true));

export const hubGet = createIsomorphicFn()
  .server(async (path: string) => {
    const { env } = await import('cloudflare:workers');
    const cookie = getRequestHeader('cookie');
    const key = (env as unknown as { WEB_KEY?: string }).WEB_KEY;
    if (path !== '/api/hub/nav' || !cookie) return read(HUB_ORIGIN + path, cookie, key);
    const hit = navKept.get(cookie);
    if (hit && Date.now() - hit.at < NAV_TTL_MS) return hit.data;
    const data = await read(HUB_ORIGIN + path, cookie, key);
    if (navKept.size >= NAV_MAX) navKept.delete(navKept.keys().next().value as string);
    navKept.set(cookie, { at: Date.now(), data });
    return data;
  })
  .client((path: string) => read(path, undefined));
