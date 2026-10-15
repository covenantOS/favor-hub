// Admin > AI use: the guard's switches (kept in KV ai:settings), today's units against the free allowance, the last 7 days, and the
// reconciler that writes Cloudflare's own totals over the guard's estimate every 10 minutes.
import type { Env } from '../http';
import { DAILY_CAP, FEATURES, FREE_UNITS, KILL_AT, TIER_CAP, monthOf, readSettings, reconcile, trueByModel, trueTotals, utcDay, type GuardStore, type Settings } from './guard';

type AiEnv = Env & { BB_KV?: KVNamespace; CF_API_KEY?: string; CF_API_EMAIL?: string; CF_ACCOUNT_ID?: string };

export const MARKETING_ACCOUNT = '6e975b8c8e7bea3f644c0eb722af991f';

export function storeOf(env: Env): GuardStore {
  return { db: env.DB as any, kv: ((env as AiEnv).BB_KV as any) || null };
}

export async function aiSettings(env: Env): Promise<Settings> {
  return readSettings(storeOf(env).kv);
}

export async function saveAiSettings(env: Env, change: (s: Settings) => void): Promise<void> {
  const kv = (env as AiEnv).BB_KV;
  if (!kv) throw new Error('The settings store is not connected to this copy of FavorOS.');
  const s = await aiSettings(env);
  const next: Settings = { allow: { ...s.allow }, extra: { ...s.extra } };
  change(next);
  await kv.put('ai:settings', JSON.stringify(next));
}

/** Pulls Cloudflare's totals for the last 7 days and writes them over the estimate. Needs CF_API_KEY and CF_API_EMAIL (Pages secrets). */
export async function reconcileNow(env: Env, fetcher: typeof fetch = fetch) {
  const e = env as AiEnv;
  if (!e.CF_API_KEY || !e.CF_API_EMAIL) throw new Error('The analytics key is not set on this copy of FavorOS.');
  const today = utcDay();
  const from = utcDay(new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86_400_000));
  const auth = { account: e.CF_ACCOUNT_ID || MARKETING_ACCOUNT, email: e.CF_API_EMAIL, key: e.CF_API_KEY };
  const totals = await trueTotals(auth, from, today, fetcher);
  // Staff use attributed by source (REST calls and test bookings are testing); without the split, the old subtraction stands.
  const split = await trueByModel(auth, from, today, fetcher).catch(() => undefined);
  return reconcile(storeOf(env), totals, today, 7, split);
}

/** The facts for Admin > AI use. */
export async function aiExtras(env: Env) {
  const today = utcDay();
  const from = utcDay(new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86_400_000));
  const [days, use, settings] = await Promise.all([
    env.DB.prepare('SELECT day, est, truth, refused, off, test_over, reconciled_at FROM ai_budget_day WHERE day >= ? ORDER BY day DESC').bind(from).all<Record<string, any>>().catch(() => ({ results: [] as Record<string, any>[] })),
    env.DB.prepare('SELECT feature, SUM(calls) AS calls, SUM(neurons) AS units, SUM(refused) AS refused FROM ai_budget_use WHERE day = ? GROUP BY feature ORDER BY units DESC').bind(today).all<Record<string, any>>().catch(() => ({ results: [] as Record<string, any>[] })),
    aiSettings(env),
  ]);
  const byDay = new Map((days.results || []).map((d) => [String(d.day), d]));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const day = utcDay(new Date(Date.parse(`${today}T12:00:00Z`) - i * 86_400_000));
    const d = byDay.get(day);
    const est = Math.round(Number(d?.est) || 0);
    const truth = Math.round(Number(d?.truth) || 0);
    week.push({ day, est, truth, used: Math.max(est, truth), refused: Number(d?.refused) || 0, off: !!d?.off, over: Math.max(0, truth - FREE_UNITS), at: d?.reconciled_at || null });
  }
  return {
    today: week[0],
    week,
    free: FREE_UNITS,
    cap: DAILY_CAP,
    kill: KILL_AT,
    tiers: TIER_CAP,
    month: monthOf(today),
    extra: Number(settings.extra[monthOf(today)]) || 0,
    features: (use.results || []).map((u) => ({ feature: String(u.feature), label: (FEATURES[String(u.feature)] || FEATURES.other).label, tier: (FEATURES[String(u.feature)] || FEATURES.other).tier, calls: Number(u.calls) || 0, units: Math.round(Number(u.units) || 0), refused: Number(u.refused) || 0 })),
  };
}
