// The daily Workers AI budget. Every model call in Favor's code goes through guardedRun: it estimates the call in neurons
// (Cloudflare's billing unit), reserves that much in one atomic D1 update against today's cap, runs the call, then corrects the
// reservation from the token counts the model reports. A call that would pass its cap does not run; it throws AiPaused and the
// feature falls back to its rules. The account gets 10,000 neurons a day free (UTC day) and bills $0.011 per 1,000 above that.
//
// Shared word for word by favor-hub (functions/_lib/ai/guard.ts) and favor-mcp (src/ai/guard.ts). Change both together.
//
// Storage (favor-requests D1, db/ai-budget.sql in favor-hub):
//   ai_budget_day  one row a UTC day: est (our running estimate), truth (Cloudflare's own total, written by the reconciler), off.
//   ai_budget_use  one row a day, feature and model: calls, neurons, refused.
// KV (the hub's BB_KV namespace, bound as AI_KV in favor-mcp and the Drive indexer):
//   ai:budget:<YYYY-MM-DD>  max(estimate, truth), kept by every call and by the reconciler every 10 minutes.
//   ai:off:<YYYY-MM-DD>     set by the reconciler when the true total passes KILL_AT; every call refuses while it stands.
//   ai:settings             JSON { allow: { feature: true }, extra: { 'YYYY-MM': units } } from Admin > Settings.

export const FREE_UNITS = 10_000;
export const DAILY_CAP = 8_000;
export const KILL_AT = 9_000;

/** How far into the day's units each tier may go. Tier 1 keeps the last 1,500 to itself, tier 2 the next 1,500, and so on. */
export const TIER_CAP: Record<number, number> = { 1: 8_000, 2: 6_500, 3: 5_000, 4: 2_500 };

export interface Feature {
  tier: 1 | 2 | 3 | 4;
  label: string;
  /** Off until an admin turns it on in Admin > Settings (the spend it brings needs Will's yes). */
  offByDefault?: boolean;
}

/** Every feature that calls a model. A call with a name not listed here runs as tier 3 under "other". */
export const FEATURES: Record<string, Feature> = {
  'clef-understand': { tier: 1, label: 'Favor Brain: reading the question' },
  'clef-pick': { tier: 1, label: 'Favor Brain: picking the answer' },
  translate: { tier: 2, label: 'Chat translation' },
  'mail-sort': { tier: 2, label: 'Mail sorting' },
  'brain-understand': { tier: 3, label: 'Favor Brain: question reader (larger model)' },
  'brain-search': { tier: 3, label: 'Favor Brain: file search' },
  'brain-howto': { tier: 3, label: 'Favor Brain: how-to answers' },
  'brain-writer': { tier: 3, label: 'Favor Brain: query writer', offByDefault: true },
  'brain-title': { tier: 3, label: 'Favor Brain: chat titles' },
  'check-triage': { tier: 3, label: 'Gift entry: sorting photos' },
  'check-reading': { tier: 3, label: 'Gift entry: reading checks', offByDefault: true },
  'mail-draft': { tier: 3, label: 'Mail: drafts and summaries' },
  'request-route': { tier: 3, label: 'Requests: sorting new requests' },
  'chat-voice': { tier: 3, label: 'Chat: voice notes to text' },
  'chat-catchup': { tier: 3, label: 'Chat: catch-up summaries' },
  brief: { tier: 3, label: 'Morning brief' },
  'plan-draft': { tier: 3, label: 'Projects: plan drafts' },
  'plan-status': { tier: 3, label: 'Projects: status lines' },
  'clip-text': { tier: 3, label: 'Clips: titles, summaries, chapters' },
  'clip-vision': { tier: 3, label: 'Clips: reading the screen' },
  'meet-notes': { tier: 3, label: 'Meetings: notes' },
  other: { tier: 3, label: 'Other' },
  'drive-index': { tier: 4, label: 'Drive index (overnight)' },
};

export const featureOf = (name: string): Feature => FEATURES[name] || FEATURES.other;

/** Thrown instead of running a call. `why`: budget (today's cap), off (feature switched off), kill (true total passed KILL_AT), closed (test override). */
export class AiPaused extends Error {
  readonly code = 'ai_paused';
  readonly why: 'budget' | 'off' | 'kill' | 'closed' | 'unavailable';
  readonly feature: string;
  constructor(why: 'budget' | 'off' | 'kill' | 'closed' | 'unavailable', feature: string) {
    super(`Model call held: ${why} (${feature})`);
    this.name = 'AiPaused';
    this.why = why;
    this.feature = feature;
  }
}

export const isAiPaused = (e: unknown): e is AiPaused => !!e && typeof e === 'object' && (e as { code?: string }).code === 'ai_paused';

// Neurons per million tokens, input and output, from Cloudflare's price list and checked against the account's own totals on
// 2026-10-12 (token counts and neurons from aiInferenceAdaptiveGroups). Where a model is not listed the guard charges the
// highest rates on the list.
interface Rate { in: number; out: number; perAudioMinute?: number }
export const RATES: Record<string, Rate> = {
  '@cf/cloudflare/clef-flash': { in: 3_455, out: 3_455 },
  '@cf/cloudflare/clef': { in: 21_819, out: 21_819 },
  '@cf/cloudflare/clef-omni': { in: 31_876, out: 50_488 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { in: 31_876, out: 50_488 },
  '@cf/openai/gpt-oss-120b': { in: 31_818, out: 68_182 },
  '@cf/openai/gpt-oss-20b': { in: 18_182, out: 27_273 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { in: 24_545, out: 77_273 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 26_668, out: 204_805 },
  '@cf/meta/llama-3.1-8b-instruct-fast': { in: 4_119, out: 34_868 },
  '@cf/meta/llama-3.1-8b-instruct-fp8': { in: 13_778, out: 26_128 },
  '@cf/meta/llama-3.1-8b-instruct': { in: 25_608, out: 75_147 },
  '@cf/meta/llama-3.2-3b-instruct': { in: 4_625, out: 30_475 },
  '@cf/meta/llama-3.2-1b-instruct': { in: 2_457, out: 18_252 },
  '@cf/google/gemma-4-26b-a4b-it': { in: 9_091, out: 27_273 },
  '@cf/google/gemma-3-12b-it': { in: 31_371, out: 50_560 },
  '@cf/meta/m2m100-1.2b': { in: 31_050, out: 31_050 },
  '@cf/baai/bge-base-en-v1.5': { in: 6_058, out: 0 },
  '@cf/baai/bge-small-en-v1.5': { in: 1_841, out: 0 },
  '@cf/baai/bge-large-en-v1.5': { in: 18_582, out: 0 },
  '@cf/baai/bge-m3': { in: 1_075, out: 0 },
  '@cf/openai/whisper-large-v3-turbo': { in: 0, out: 0, perAudioMinute: 46.63 },
  '@cf/openai/whisper': { in: 0, out: 0, perAudioMinute: 41.14 },
  // toMarkdown on an image runs a vision model; the guard charges it as one.
  'tomarkdown-image': { in: 31_876, out: 50_488 },
};
const UNKNOWN: Rate = { in: 31_876, out: 204_805 };
const IMAGE_TOKENS = 2_000;
// Output tokens assumed before the call when the input does not cap them. gpt-oss thinks before it answers, so it gets more.
const DEFAULT_OUT = (model: string) => (/gpt-oss/.test(model) ? 2_048 : /m2m100/.test(model) ? 0 : 512);
const isEmbed = (model: string) => /\/baai\/|embed/.test(model);
const isClef = (model: string) => /\/cloudflare\/clef/.test(model);

function textLength(v: unknown, images: { n: number }): number {
  if (v == null) return 0;
  if (typeof v === 'string') return v.length;
  if (typeof v === 'number' || typeof v === 'boolean') return 4;
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return 0;
  if (Array.isArray(v)) return v.reduce((s: number, x) => s + textLength(x, images), 0);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'image_url' || o.type === 'image' || o.image_url) {
      images.n++;
      return 0;
    }
    let s = 0;
    for (const [k, x] of Object.entries(o)) {
      if (k === 'image' || k === 'audio') {
        if (k === 'image' && x) images.n++;
        continue;
      }
      if (k === 'max_tokens' || k === 'temperature' || k === 'stream' || k === 'model') continue;
      s += k.length + textLength(x, images);
    }
    return s;
  }
  return 0;
}

function audioBytes(input: Record<string, unknown>): number {
  const a = input.audio as unknown;
  if (!a) return 0;
  if (typeof a === 'string') return Math.ceil(a.length * 0.75);
  if (Array.isArray(a)) return a.length;
  if (a instanceof ArrayBuffer) return a.byteLength;
  if (ArrayBuffer.isView(a)) return a.byteLength;
  return 0;
}

/** The neurons a call will cost, erring high: three characters a token for text and code, two for Clef's labelled input. */
export function estimateNeurons(model: string, input: unknown): number {
  const rate = RATES[model] || UNKNOWN;
  const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (rate.perAudioMinute) {
    // Compressed speech runs about 2,000 bytes a second at the low end, so bytes / 2,000 overstates the length.
    const seconds = Math.max(5, audioBytes(inp) / 2_000);
    return Math.ceil((seconds / 60) * rate.perAudioMinute) + 1;
  }
  const images = { n: 0 };
  const chars = textLength(inp, images);
  const inTokens = Math.ceil(chars / (isClef(model) ? 2.5 : 3)) + 32 + images.n * IMAGE_TOKENS;
  const capOut = Number(inp.max_tokens ?? inp.max_completion_tokens);
  let outTokens = isEmbed(model) || isClef(model) ? 0 : Number.isFinite(capOut) && capOut > 0 ? capOut : DEFAULT_OUT(model);
  if (/m2m100/.test(model)) outTokens = Math.ceil(inTokens * 1.5);
  return Math.ceil((inTokens * rate.in + outTokens * rate.out) / 1_000_000) + 1;
}

/** The neurons a finished call cost, from the token counts the model reported. Null when it reported none. */
export function actualNeurons(model: string, output: unknown): number | null {
  const rate = RATES[model] || UNKNOWN;
  const u = (output && typeof output === 'object' ? (output as Record<string, any>).usage : null) as Record<string, number> | null;
  if (!u) return null;
  const pin = Number(u.prompt_tokens ?? u.input_tokens);
  const pout = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  if (!Number.isFinite(pin) || pin <= 0) return null;
  // Ten percent over what the model reported keeps the running estimate above Cloudflare's own count.
  return Math.ceil(((pin * rate.in + (Number.isFinite(pout) ? pout : 0) * rate.out) / 1_000_000) * 1.1) + 1;
}

// ---- Storage ----------------------------------------------------------------------------------------------------------

export interface D1Like {
  prepare(sql: string): { bind(...a: unknown[]): { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> } };
}
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<unknown>;
}
export interface GuardStore {
  db: D1Like;
  kv?: KVLike | null;
}

export interface Settings {
  allow: Record<string, boolean>;
  /** Extra units a month for runs flagged as tests, keyed YYYY-MM. 0 unless an admin raised it. */
  extra: Record<string, number>;
}
export const DEFAULT_SETTINGS: Settings = { allow: {}, extra: {} };

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const monthOf = (day: string) => day.slice(0, 7);

let cache: { at: number; settings: Settings; off: Record<string, boolean>; kvUsed: Record<string, number> } | null = null;
const CACHE_MS = 20_000;

export function resetGuardCache(): void {
  cache = null;
}

export async function readSettings(kv: KVLike | null | undefined): Promise<Settings> {
  if (!kv) return DEFAULT_SETTINGS;
  try {
    const raw = await kv.get('ai:settings');
    const s = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return { allow: s.allow || {}, extra: s.extra || {} };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function readState(store: GuardStore, day: string) {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS && day in cache.off) return cache;
  const kv = store.kv;
  const [settings, off, used] = await Promise.all([
    readSettings(kv),
    kv ? kv.get(`ai:off:${day}`).catch(() => null) : Promise.resolve(null),
    kv ? kv.get(`ai:budget:${day}`).catch(() => null) : Promise.resolve(null),
  ]);
  cache = { at: now, settings, off: { [day]: off === '1' }, kvUsed: { [day]: Number(used) || 0 } };
  return cache;
}

/** Extra test units left this month: the monthly allowance less what test runs already took past the daily cap. */
export async function extraLeft(store: GuardStore, settings: Settings, day: string): Promise<number> {
  const allowance = Math.max(0, Number(settings.extra[monthOf(day)]) || 0);
  if (!allowance) return 0;
  const row = await store.db
    .prepare('SELECT COALESCE(SUM(test_over), 0) AS used FROM ai_budget_day WHERE day >= ? AND day <= ?')
    .bind(`${monthOf(day)}-01`, day)
    .first<{ used: number }>();
  return Math.max(0, allowance - (Number(row?.used) || 0));
}

export interface GuardOpts {
  feature: string;
  /** A test run (scripts with FAVOR_AI_LIVE=1, the test runner). Only these may draw on the month's extra test units. */
  test?: boolean;
  /** Refuse every call (the FavorOS Tester's forced-closed switch). */
  closed?: boolean;
  day?: string;
}

async function bump(store: GuardStore, day: string, feature: string, model: string, neurons: number, refused: boolean) {
  await store.db
    .prepare(
      'INSERT INTO ai_budget_use (day, feature, model, calls, neurons, refused) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(day, feature, model) DO UPDATE SET calls = calls + excluded.calls, neurons = neurons + excluded.neurons, refused = refused + excluded.refused',
    )
    .bind(day, feature, model, refused ? 0 : 1, refused ? 0 : neurons, refused ? 1 : 0)
    .run()
    .catch(() => {});
}

/**
 * Reserves the call's estimate against today's cap. Returns the reservation, or throws AiPaused. Exported for callers that do not
 * go through a binding (toMarkdown, REST from scripts): reserve, make the call, then settle().
 */
export async function reserve(store: GuardStore, opts: GuardOpts, model: string, input: unknown): Promise<{ day: string; est: number; test: boolean }> {
  const day = opts.day || utcDay();
  const feature = opts.feature in FEATURES ? opts.feature : 'other';
  const f = featureOf(feature);
  if (opts.closed) {
    await bump(store, day, feature, model, 0, true);
    throw new AiPaused('closed', feature);
  }
  let state;
  try {
    state = await readState(store, day);
  } catch {
    throw new AiPaused('unavailable', feature);
  }
  if (f.offByDefault && !state.settings.allow[feature]) {
    await bump(store, day, feature, model, 0, true);
    throw new AiPaused('off', feature);
  }
  if (state.off[day]) {
    await bump(store, day, feature, model, 0, true);
    throw new AiPaused('kill', feature);
  }
  const est = estimateNeurons(model, input);
  let cap = TIER_CAP[f.tier] ?? TIER_CAP[3];
  let test = false;
  if (opts.test) {
    const left = await extraLeft(store, state.settings, day).catch(() => 0);
    if (left > 0) {
      cap = DAILY_CAP + left;
      test = true;
    }
  }
  const floor = state.kvUsed[day] || 0;
  let row: { est: number } | null = null;
  try {
    await store.db.prepare('INSERT OR IGNORE INTO ai_budget_day (day) VALUES (?)').bind(day).run();
    // One statement: the check and the reservation cannot be split by another call landing between them.
    row = await store.db
      .prepare(
        'UPDATE ai_budget_day SET est = est + ?2, test_over = test_over + CASE WHEN ?5 = 1 THEN MAX(0, MIN(?2, MAX(est, truth, ?4) + ?2 - ?6)) ELSE 0 END ' +
          'WHERE day = ?1 AND off = 0 AND MAX(est, truth, ?4) + ?2 <= ?3 RETURNING est',
      )
      .bind(day, est, cap, floor, test ? 1 : 0, DAILY_CAP)
      .first<{ est: number }>();
  } catch {
    throw new AiPaused('unavailable', feature);
  }
  if (!row) {
    await store.db.prepare('UPDATE ai_budget_day SET refused = refused + 1 WHERE day = ?').bind(day).run().catch(() => {});
    await bump(store, day, feature, model, 0, true);
    throw new AiPaused('budget', feature);
  }
  return { day, est, test };
}

/** Corrects the reservation from what the model reported, records the call, and mirrors the day's total to KV. */
export async function settle(store: GuardStore, r: { day: string; est: number }, feature: string, model: string, output: unknown): Promise<void> {
  const real = actualNeurons(model, output);
  const used = real ?? r.est;
  const delta = used - r.est;
  try {
    let total: { est: number; truth: number } | null;
    if (delta !== 0) {
      total = await store.db.prepare('UPDATE ai_budget_day SET est = MAX(0, est + ?) WHERE day = ? RETURNING est, truth').bind(delta, r.day).first();
    } else {
      total = await store.db.prepare('SELECT est, truth FROM ai_budget_day WHERE day = ?').bind(r.day).first();
    }
    await bump(store, r.day, feature in FEATURES ? feature : 'other', model, used, false);
    if (store.kv && total) {
      const v = Math.ceil(Math.max(Number(total.est) || 0, Number(total.truth) || 0));
      // KV takes one write a second per key; a lost write is made good by the next call or the reconciler.
      await store.kv.put(`ai:budget:${r.day}`, String(v), { expirationTtl: 60 * 60 * 24 * 40 }).catch(() => {});
    }
  } catch {
    // the reservation stands, which errs high
  }
}

/** Runs one model call through the budget. Throws AiPaused when the call may not run. */
export async function guardedRun(store: GuardStore, run: (model: string, input: unknown) => Promise<unknown>, opts: GuardOpts, model: string, input: unknown): Promise<unknown> {
  const r = await reserve(store, opts, model, input);
  const out = await run(model, input);
  await settle(store, r, opts.feature, model, out);
  return out;
}

/** A Workers AI binding whose every call goes through the budget under one feature name. */
export interface GuardedAi {
  run(model: string, input: unknown): Promise<any>;
  runFor(feature: string, model: string, input: unknown): Promise<any>;
  guarded: true;
}

export function guardBinding(store: GuardStore, ai: { run(model: string, input: unknown, opts?: unknown): Promise<unknown> }, base: Omit<GuardOpts, 'feature'> & { closedFor?: () => boolean; testFor?: () => boolean } = {}): GuardedAi {
  const call = (feature: string, model: string, input: unknown) =>
    guardedRun(store, (m, i) => ai.run(m, i), { ...base, feature, closed: base.closed || base.closedFor?.() || false, test: base.test || base.testFor?.() || false }, model, input);
  return { guarded: true, run: (model, input) => call('other', model, input), runFor: call };
}

/** The same binding, with every call named as one feature. Works on a plain binding too (tests pass stand-ins). */
export function aiFor<T extends { run(model: string, input: unknown): Promise<unknown> } | undefined | null>(ai: T, feature: string): T {
  if (!ai) return ai;
  const g = ai as unknown as Partial<GuardedAi>;
  if (typeof g.runFor !== 'function') return ai;
  return { run: (model: string, input: unknown) => g.runFor!(feature, model, input) } as unknown as T;
}

// ---- Reconciler -------------------------------------------------------------------------------------------------------

/** Cloudflare's own neuron totals by UTC day, from the GraphQL analytics API. */
export async function trueTotals(auth: { account: string; email: string; key: string }, from: string, to: string, fetcher: typeof fetch = fetch): Promise<Record<string, number>> {
  const query = `query($a:String!,$s:Date!,$e:Date!){viewer{accounts(filter:{accountTag:$a}){aiInferenceAdaptiveGroups(limit:1000,filter:{date_geq:$s,date_leq:$e}){sum{totalNeurons} dimensions{date}}}}}`;
  const res = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { 'X-Auth-Email': auth.email, 'X-Auth-Key': auth.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: auth.account, s: from, e: to } }),
  });
  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok || body?.errors?.length) throw new Error(`analytics answered ${res.status}: ${JSON.stringify(body?.errors || '').slice(0, 200)}`);
  const out: Record<string, number> = {};
  for (const g of body?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups || []) {
    const d = g.dimensions?.date;
    if (d) out[d] = (out[d] || 0) + (Number(g.sum?.totalNeurons) || 0);
  }
  return out;
}

/** Writes Cloudflare's totals for the last `days` days into D1 and KV, and sets today's kill flag past KILL_AT. */
export async function reconcile(store: GuardStore, totals: Record<string, number>, today = utcDay(), days = 7): Promise<{ day: string; est: number; truth: number; used: number; off: boolean }> {
  const settings = await readSettings(store.kv);
  const stamp = new Date().toISOString();
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(Date.parse(`${today}T12:00:00Z`) - i * 86_400_000));
    const truth = Math.round((totals[day] || 0) * 100) / 100;
    await store.db.prepare('INSERT OR IGNORE INTO ai_budget_day (day) VALUES (?)').bind(day).run();
    await store.db.prepare('UPDATE ai_budget_day SET truth = MAX(truth, ?), reconciled_at = ? WHERE day = ?').bind(truth, stamp, day).run();
  }
  const row = (await store.db.prepare('SELECT est, truth, off, test_over FROM ai_budget_day WHERE day = ?').bind(today).first<{ est: number; truth: number; off: number; test_over: number }>()) || { est: 0, truth: 0, off: 0, test_over: 0 };
  const used = Math.ceil(Math.max(Number(row.est) || 0, Number(row.truth) || 0));
  const extra = (await extraLeft(store, settings, today).catch(() => 0)) + (Number(row.test_over) || 0);
  const kill = Number(row.truth) > KILL_AT + extra;
  if (kill && !row.off) await store.db.prepare('UPDATE ai_budget_day SET off = 1 WHERE day = ?').bind(today).run();
  if (store.kv) {
    await store.kv.put(`ai:budget:${today}`, String(used), { expirationTtl: 60 * 60 * 24 * 40 });
    if (kill) await store.kv.put(`ai:off:${today}`, '1', { expirationTtl: 60 * 60 * 48 });
  }
  resetGuardCache();
  return { day: today, est: Number(row.est) || 0, truth: Number(row.truth) || 0, used, off: kill || !!row.off };
}
