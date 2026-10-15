// One read helper for both sides. On the server it calls the live hub with the visitor's own cookie (in the real move this becomes
// a direct call into functions/_lib through a service binding, no network hop). In the browser it is a same-origin fetch.
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';

const HUB = 'https://dash.favorintl.org';

export class SignInNeeded extends Error {}

async function read(url: string, cookie: string | undefined): Promise<unknown> {
  const res = await fetch(url, { headers: { 'X-Hub-Request': '1', accept: 'application/json', ...(cookie ? { cookie } : {}) }, credentials: 'same-origin' });
  if (res.status === 401) throw new SignInNeeded('Sign in to FavorOS first.');
  const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || !data || data.ok === false) throw new Error((data && data.message) || 'Something went wrong. Try again.');
  return data;
}

export const hubGet = createIsomorphicFn()
  .server((path: string) => read(HUB + path, getRequestHeader('cookie')))
  .client((path: string) => read(path, undefined));
