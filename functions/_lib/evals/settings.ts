// Evaluation settings and who may use the area while it is in testing.
//
// Access (2026-10-15): the Early access list (hub setting early_access), plus the people in evals.access (Grace), plus hub admins and HR.
// Everyone else gets a plain "not open yet" from the API and the page. Nothing is announced to staff.
import type { Env } from '../http';
import { hubValue } from '../admin/hubcache';
import { effective } from '../admin/settings';
import { parseAccess } from '../access';
import { isHr } from '../people-dev';
import { PROBE_EMAILS } from '../testuser';

type Db = Pick<Env, 'DB'>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** Rachel's Employee Evaluation and Development Summary, the final form the employee receives. Opens as a copy. */
export const DEFAULT_SUMMARY_URL = 'https://docs.google.com/document/d/1pgaiNGZiMti7b__V1H3QtqVJzvO4GpSBj7qBRvvjQC0/copy';
/** Rachel's Evaluation Questions document, which holds the supervisor instruction page at the bottom. HR replaces it with the final page. */
export const DEFAULT_INSTRUCTIONS_URL = 'https://docs.google.com/document/d/1LNhsspcLpxyf7wPaGJv_X9kEOBomH_Uj-HBg6kOb_AI/edit';
/** Who supervises Rachel and Michael until Admin > People holds a line for them (Will, 2026-10-15). A fallback, never written to the reporting table. */
export const DEFAULT_SUPERVISORS = '{"rachel@favorintl.org":"terry@favorintl.org","michael@favorintl.org":"terry@favorintl.org"}';
export const DEFAULT_EXTRA_ACCESS = '{"emails":["grace@favorintl.org"],"teams":[]}';

export interface EvalSettings {
  summaryUrl: string;
  instructionsUrl: string;
  supervisors: Record<string, string>;
}

const isUrl = (s: string) => /^https:\/\/docs\.google\.com\//.test(s);

/** Reads leniently: a bad value falls back to the default. */
export function parseSupervisors(raw: unknown): Record<string, string> {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const a = lower(k);
      const b = lower(x);
      if (a && b && a !== b) out[a] = b;
    }
  }
  return out;
}

export async function evalSettings(env: Db): Promise<EvalSettings> {
  const e = env as Env;
  const [summary, instr, sup] = await Promise.all([
    effective(e, 'evals.summary_url', undefined, DEFAULT_SUMMARY_URL).catch(() => DEFAULT_SUMMARY_URL),
    effective(e, 'evals.instructions_url', undefined, DEFAULT_INSTRUCTIONS_URL).catch(() => DEFAULT_INSTRUCTIONS_URL),
    effective(e, 'evals.supervisors', undefined, DEFAULT_SUPERVISORS).catch(() => DEFAULT_SUPERVISORS),
  ]);
  return {
    summaryUrl: isUrl(summary.trim()) ? summary.trim() : DEFAULT_SUMMARY_URL,
    instructionsUrl: isUrl(instr.trim()) ? instr.trim() : DEFAULT_INSTRUCTIONS_URL,
    supervisors: parseSupervisors(sup),
  };
}

async function members(env: Db, key: string, fallback: string): Promise<Set<string>> {
  const raw = await effective(env as Env, key, undefined, fallback).catch(() => fallback);
  const list = parseAccess(raw);
  const out = new Set(list.emails);
  if (list.teams.length) {
    const r = await env.DB.prepare('SELECT lower(email) AS email, team FROM meet_directory WHERE active = 1').all<{ email: string; team: string }>().catch(() => ({ results: [] as Array<{ email: string; team: string }> }));
    const want = new Set(list.teams.map(lower));
    for (const p of r.results || []) if (want.has(lower(p.team))) out.add(lower(p.email));
  }
  return out;
}

/** The testing audience: Early access list, evals.access, hub admins and HR. */
export async function mayUseEvals(env: Db, user: { email: string; role?: string } | null | undefined): Promise<boolean> {
  if (!user) return false;
  const email = lower(user.email);
  if (user.role === 'admin') return true;
  if (PROBE_EMAILS.includes(email)) return false;
  const early = parseAccess(await hubValue(env as Env, 'early_access').catch(() => null));
  if (early.emails.includes(email)) return true;
  if ((await members(env, 'evals.access', DEFAULT_EXTRA_ACCESS)).has(email)) return true;
  if (early.teams.length) {
    const r = await env.DB.prepare('SELECT lower(team) AS team FROM meet_directory WHERE active = 1 AND lower(email) = ?').bind(email).first<{ team: string }>().catch(() => null);
    if (r && early.teams.map(lower).includes(r.team)) return true;
  }
  return isHr(env as Env, email);
}
