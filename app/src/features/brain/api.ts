// Calls to /api/brain/<path> as the signed-in person, and the question itself with its steps streamed (NDJSON).
// Reads that a page draws on its first frame are queryOptions built over a `get` the page passes in: the web app's hubGet
// (server and browser), the dock's plain browser fetch.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { queryOptions } from '@tanstack/react-query';
import type { ConvRow, Me, Step, StoredTurn } from './types';

export class BrainError extends Error {
  status: number;
  ref?: string;
  constructor(message: string, status: number, ref?: string) {
    super(message);
    this.name = 'BrainError';
    this.status = status;
    this.ref = ref;
  }
}

export interface CallOpt {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** A call to /api/brain/<path>. Throws BrainError with the server's message. */
export async function brainCall<T = any>(path: string, opt: CallOpt = {}): Promise<T> {
  const res = await fetch('/api/brain/' + path, {
    method: opt.method || (opt.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'X-Hub-Request': '1', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
    signal: opt.signal,
  });
  const d = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || d.ok === false) throw new BrainError(d.message || d.error || 'The Brain did not answer (' + res.status + ').', res.status, d.ref);
  return d as T;
}

/** A plain same-origin JSON read (the dock's `get`). */
export async function browserGet(path: string): Promise<unknown> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1', accept: 'application/json' } });
  const d = (await res.json().catch(() => null)) as any;
  if (!res.ok || !d || d.ok === false) throw new BrainError((d && d.message) || 'Something went wrong. Try again.', res.status);
  return d;
}

/**
 * Asks with the steps streamed. onSteps(steps) runs on every change; resolves to the answer JSON. A server that answers with
 * plain JSON still works (no steps until the answer).
 */
export async function askStream(body: unknown, opt: { signal?: AbortSignal; onSteps?: (s: Step[]) => void } = {}): Promise<any> {
  const res = await fetch('/api/brain/ask', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Hub-Request': '1' },
    body: JSON.stringify(body),
    signal: opt.signal,
  });
  const type = res.headers.get('Content-Type') || '';
  let d: any = null;
  let status = res.status;
  if (type.includes('ndjson') && res.body) {
    const rd = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const take = (ln: string) => {
      if (!ln.trim()) return;
      let o: any;
      try {
        o = JSON.parse(ln);
      } catch {
        return;
      }
      if (o.steps && opt.onSteps) opt.onSteps(o.steps);
      if (o.final) {
        d = o.final;
        status = o.status || status;
      }
    };
    for (;;) {
      const r = await rd.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        take(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    take(buf);
  } else d = await res.json().catch(() => ({}));
  d = d || {};
  if (status >= 400 || d.ok === false) throw new BrainError(d.message || d.error || 'The Brain did not answer (' + status + ').', status, d.ref);
  return d;
}

export type Get = (path: string) => Promise<unknown>;

export const brainKeys = {
  me: ['brain', 'me'] as const,
  history: ['brain', 'history'] as const,
  thread: (id: string) => ['brain', 'thread', id] as const,
  connector: ['brain', 'connector'] as const,
  sheets: ['brain', 'sheets'] as const,
};

export const meQuery = (get: Get) => queryOptions({ queryKey: brainKeys.me, queryFn: async () => (await get('/api/brain/me')) as Me, staleTime: 60_000 });
export const historyQuery = (get: Get) =>
  queryOptions({ queryKey: brainKeys.history, queryFn: async () => (((await get('/api/brain/history')) as { threads?: ConvRow[] }).threads || []) as ConvRow[], staleTime: 10_000 });
export const threadQuery = (get: Get, id: string) =>
  queryOptions({
    queryKey: brainKeys.thread(id),
    queryFn: async () => {
      // No chat in the address: nothing to read.
      if (id === '-') return null;
      try {
        return (await get('/api/brain/thread/' + encodeURIComponent(id))) as { thread: { id: string; title: string }; turns: StoredTurn[] };
      } catch (e) {
        // A chat that is gone opens as a new chat, never as an error page.
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
    staleTime: 5_000,
  });
