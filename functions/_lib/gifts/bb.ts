// The hub's one door to Blackbaud for gift entry: favorintl.org's /api/blackbaud/gift-entry route, which holds the Blackbaud
// connection, writes only what P0 proved, and counts every call against its own lane of 400 a day (never the upkeep route's
// allowance or the giving form's). This file never talks to Blackbaud directly.
import { opsUrl } from '../foundations/blackbaud';
import type { Env } from '../http';

export interface BbCall {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface BbResult {
  ok: boolean;
  status: number;
  body: any;
  refused?: string;
}

export interface BbAnswer {
  results: BbResult[];
  callsToday?: number;
  cap?: number;
  warn?: boolean;
  /** Blackbaud or the lane cannot take the call now. Nothing was sent; the outbox keeps the step and tries later. */
  wait?: string;
  /** The answer never arrived. A write may or may not have landed, so the caller checks before it sends again. */
  lost?: boolean;
  /** The day's lane is spent. The step waits for the UTC reset. */
  capped?: boolean;
}

export type BbSend = (calls: BbCall[]) => Promise<BbAnswer>;

export async function giftEntryUrl(env: Env): Promise<string> {
  const ops = await opsUrl(env);
  return ops.replace(/\/ops\/?$/, '/gift-entry');
}

export function bbSender(env: Env): BbSend {
  return async (calls) => {
    if (!env.BLACKBAUD_SETUP_KEY) return { results: [], wait: 'The Blackbaud connection is not set up on the hub yet.' };
    if (calls.length < 1 || calls.length > 5) throw new Error('send between 1 and 5 calls');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 28000);
    try {
      const res = await fetch(await giftEntryUrl(env), {
        method: 'POST',
        headers: { 'X-Setup-Key': env.BLACKBAUD_SETUP_KEY, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 favor-hub-gifts' },
        body: JSON.stringify({ calls }),
        signal: ctl.signal,
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!data) return { results: [], wait: 'Blackbaud did not answer. It will try again.', lost: true };
      if (data.error === 'daily_cap') return { results: [], capped: true, wait: "Blackbaud's daily limit is reached. It sends after the reset." };
      if (data.error === 'quota_stop') return { results: [], capped: true, wait: "Blackbaud is at today's limit. It sends after the reset." };
      if (!Array.isArray(data.results)) return { results: [], wait: 'The Blackbaud connection turned the call away. It will try again.' };
      return {
        results: data.results.map((r: any) =>
          r.status === 0 && r.body && r.body.refused ? { ok: false, status: 0, body: r.body, refused: String(r.body.refused) } : { ok: Boolean(r.ok), status: Number(r.status) || 0, body: r.body }
        ),
        callsToday: Number(data.calls_today) || undefined,
        cap: Number(data.cap) || undefined,
        warn: Boolean(data.warn),
      };
    } catch {
      return { results: [], wait: 'Blackbaud did not answer. It will try again.', lost: true };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Today's lane count, read from the route's ledger endpoint. Makes no Blackbaud call. */
export async function laneToday(env: Env): Promise<{ calls: number; cap: number; warnAt: number; only: string | null } | null> {
  if (!env.BLACKBAUD_SETUP_KEY) return null;
  try {
    const res = await fetch(await giftEntryUrl(env), { headers: { 'X-Setup-Key': env.BLACKBAUD_SETUP_KEY, 'User-Agent': 'Mozilla/5.0 favor-hub-gifts' } });
    const d = (await res.json().catch(() => null)) as any;
    if (!d || d.ok !== true) return null;
    return { calls: Number(d.calls) || 0, cap: Number(d.cap) || 400, warnAt: Number(d.warn_at) || 300, only: d.only || null };
  } catch {
    return null;
  }
}

/** Blackbaud's reason in plain words, for the status view. */
export function sayWhy(body: any): string {
  if (!body) return 'Blackbaud turned it down.';
  if (typeof body === 'string') return body.slice(0, 240);
  if (Array.isArray(body) && body[0]) return String(body[0].message || body[0].error_name || JSON.stringify(body[0])).slice(0, 240);
  return String(body.detail || body.message || body.title || body.error || JSON.stringify(body)).slice(0, 240);
}
