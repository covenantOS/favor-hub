// The Meetings fetch helpers, with no components in the file so route files can use them. (React twin of api() in public/js/meet/ui.js.)
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export class MeetError extends Error {
  status = 0;
  code = '';
}
/** A call to /api/meet/<path> from the browser (writes carry X-Hub-Request, as every hub write does). Throws MeetError with the server's message. */
export async function meetApi<T = Record<string, any>>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch('/api/meet/' + path, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'X-Hub-Request': '1', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let j: any = {};
  try {
    j = await r.json();
  } catch {
    // not JSON
  }
  if (!r.ok) {
    const e = new MeetError(j.message || 'Something went wrong. Try again.');
    e.status = r.status;
    e.code = j.error;
    throw e;
  }
  return j as T;
}
/** A read of /api/meet/<path> that also works on the server (through hubGet). */
export const meetQuery = <T = Record<string, any>,>(path: string, key: unknown[] = ['meet', path], extra: { staleTime?: number } = {}) =>
  queryOptions({ queryKey: key, queryFn: async () => (await hubGet('/api/meet/' + path)) as T, staleTime: extra.staleTime ?? 15_000 });
