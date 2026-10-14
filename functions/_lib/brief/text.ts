// Plain-English text for the briefing, the partner story, the catch-up and the call summary. Workers AI writes it from facts the
// server already holds; every caller has a fixed sentence to fall back on, so a slow or missing model never blanks a card.
// Staff-facing text never mentions how it was written.
import type { Env } from '../http';
import { aiFor, isAiPaused } from '../ai/guard';

export const BRIEF_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];

const BANNED: Array<[RegExp, string]> = [
  [/\bdonors\b/gi, 'partners'],
  [/\bdonor\b/gi, 'partner'],
  [/\bleverag(e|es|ed|ing)\b/gi, 'use'],
  [/\butiliz(e|es|ed|ing)\b/gi, 'use'],
  [/\bdelve\b/gi, 'look'],
  [/\bjust\b\s*/gi, ''],
  [/\bsimply\b\s*/gi, ''],
  [/\bactually\b\s*/gi, ''],
];

const DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2014, 0x2013) + ']\\s*', 'g');

/** Clean model output into the house style: no dashes used as breaks, no banned words, no quotes around the whole text, one space. */
export function scrub(s: string): string {
  let t = String(s || '').trim();
  t = t.replace(/^["'`]+|["'`]+$/g, '');
  t = t.replace(DASHES, ', ').replace(/\s+--\s+/g, ', ');
  for (const [re, to] of BANNED) t = t.replace(re, to);
  t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

type Run = { run(model: string, input: unknown): Promise<unknown> };

const PADDING = /\b(tackle|notable|notably|contributions?|fortunately|unfortunately|a number of|important|importantly|gratitude|grateful|express(?:ing)? (?:our|your)|generous|dedicated|remarkable|significant(?:ly)?|valuable|crucial|vital|ensure|journey|testament|indeed|additionally|furthermore|moreover|overall|ultimately|in conclusion|it is worth|it's worth|reach out|touch base|delve|leverage|streamline|robust|seamless|heartwarming|wonderful|amazing|great news)\b/i;
const ZERO = /\b(no record of|not on record|nothing on record|there (?:are|is) (?:no|none)|none at this time|nothing (?:is |to )?(?:late|waiting|overdue|due)|no (?:late|overdue|waiting)|zero|0 (?:late|overdue|waiting))\b/i;

/** True when model text is short and plain: at most two sentences, no padding words, no statement that something is absent. */
export function acceptable(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || t.length > 300) return false;
  if (PADDING.test(t) || ZERO.test(t)) return false;
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.length <= 2;
}

/** The first two sentences of a text, or null when it is empty. */
export function twoSentences(text: string): string {
  return String(text || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(' ');
}

export interface WriteOpts {
  /** Skip the plain-text filter (for JSON answers the caller checks itself). */
  raw?: boolean;
  system: string;
  user: string;
  max?: number;
  timeoutMs?: number;
  temperature?: number;
}

/** One short piece of text from the model, scrubbed. Null when the model is not bound, is slow, or says nothing. */
export async function writeText(env: Pick<Env, 'AI'>, o: WriteOpts): Promise<string | null> {
  const ai = aiFor(env.AI, 'brief') as Run | undefined;
  if (!ai) return null;
  for (const model of BRIEF_MODELS) {
    try {
      const run = ai.run(model, {
        messages: [
          { role: 'system', content: o.system },
          { role: 'user', content: o.user },
        ],
        max_tokens: o.max ?? 220,
        temperature: o.temperature ?? 0.3,
      }) as Promise<{ response?: string }>;
      const out = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), o.timeoutMs ?? 12000))]);
      const text = scrub(String((out as { response?: string } | null)?.response || ''));
      if (text && (o.raw || acceptable(text))) return text;
    } catch (err) {
      if (isAiPaused(err)) return null;
      console.error('[brief] ai', model, String((err as Error)?.message || err).slice(0, 200));
    }
  }
  return null;
}

/** The style every prompt shares. */
export const HOUSE = 'Write for a ministry staff member. At most two short sentences. Plain and factual, with no adjectives that praise or judge. Say gifts, never contributions. Use only the facts given. Do not invent names, dates or amounts. No em dashes, no lists, no headings. Say "partners", never "donors". Never mention AI, models or that this was generated.';

/* ------------------------------------------------------------------ the saved copy (act_cache: key, value, at) */

export async function cacheGet<T>(env: Pick<Env, 'DB'>, key: string, ttlMs: number): Promise<T | null> {
  const row = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(key).first<{ value: string; at: string }>().catch(() => null);
  if (!row || Date.now() - Date.parse(row.at) > ttlMs) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

/** The saved copy and its age in ms, however old. Null when there is none or it does not parse. */
export async function cacheAged<T>(env: Pick<Env, 'DB'>, key: string): Promise<{ value: T; age: number } | null> {
  const row = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(key).first<{ value: string; at: string }>().catch(() => null);
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, age: Date.now() - Date.parse(row.at) };
  } catch {
    return null;
  }
}

export async function cachePut(env: Pick<Env, 'DB'>, key: string, value: unknown): Promise<void> {
  await env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run()
    .catch(() => undefined);
}

/** A short stable hash of facts, so a saved paragraph is reused only while the facts under it are the same. */
export function sig(v: unknown): string {
  const s = JSON.stringify(v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const money = (n: number): string => '$' + (Math.round(n) === n ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (iso: string): string => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : '');
export const longDay = (iso: string, today: string): string => (iso ? shortDay(iso) + (iso.slice(0, 4) === today.slice(0, 4) ? '' : ', ' + iso.slice(0, 4)) : '');
export const plural = (n: number, one: string, many = one + 's'): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export const dayDiff = (a: string, b: string): number => Math.round((Date.parse(b.slice(0, 10) + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / 86400000);
export const addDays = (ymd: string, n: number): string => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
