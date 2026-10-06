// The sync worker reads and marks gifts in Blackbaud for this page, with its
// own Blackbaud connection. The giving form's allowance is never touched.

import { HttpError, type Env } from '../http';

const WORKER_URL = 'https://re-nxt-cloud-sync.super-paper-a785.workers.dev';

async function call<T>(env: Env, path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!env.RECEIPTS_KEY) throw new HttpError(503, 'not_set_up', 'The Blackbaud connection is not set up on the hub yet.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.RECEIPTS_WORKER_URL || WORKER_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RECEIPTS_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as any;
    if (res.status === 429) throw new HttpError(429, 'limit', "Blackbaud is at today's limit. Try again after 8 PM Eastern.");
    if (!res.ok || !data) {
      throw new HttpError(502, 'blackbaud', `Blackbaud did not answer as expected (${data?.error || res.status}). Try again in a minute.`);
    }
    return data as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(504, 'timeout', 'Blackbaud took too long to answer. Try again in a minute.');
  } finally {
    clearTimeout(timer);
  }
}

export async function queryWaiting(env: Env, days: number): Promise<string> {
  const out = await call<{ ok: boolean; csv: string }>(env, '/receipts/query', { mode: 'waiting', days }, 90000);
  return out.csv;
}

export async function queryThankedOn(env: Env, date: string): Promise<string> {
  const out = await call<{ ok: boolean; csv: string }>(env, '/receipts/query', { mode: 'thanked', date }, 90000);
  return out.csv;
}

export interface AckResult {
  id: string;
  ok: boolean;
  status: number;
  detail?: string;
}

export async function acknowledge(env: Env, batch: string, date: string, ids: string[]): Promise<{ results: AckResult[]; stopped: string }> {
  const out = await call<{ results: AckResult[]; stopped: string }>(env, '/receipts/acknowledge', { batch, date, ids }, 120000);
  return { results: out.results || [], stopped: out.stopped || '' };
}
