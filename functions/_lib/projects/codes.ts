// Favor's Blackbaud codes for a task: appeal, source, fund and campaign. The lists come from the Blackbaud mirror's code tables
// through the same read path the gift and report screens use, and are kept for ten minutes in the running worker. When the mirror
// does not answer, the last good list is used; with none, the codes already typed on tasks are offered and the answer says typed.
import type { Env } from '../http';
import { mirror } from '../foundations/blackbaud';

export const KINDS = ['appeal', 'source', 'fund', 'campaign'] as const;
export type CodeKind = (typeof KINDS)[number];

export interface Code {
  code: string;
  description: string;
}

const TTL_MS = 10 * 60_000;
const cache = new Map<CodeKind, { at: number; codes: Code[] }>();

/** Tests clear this between cases. */
export function resetCodeCache(): void {
  cache.clear();
}

const SQL: Record<CodeKind, string> = {
  appeal: `SELECT appeal_id AS code, appeal_description AS description FROM appeals WHERE COALESCE(appeal_inactive, 0) = 0 AND appeal_id IS NOT NULL ORDER BY appeal_id`,
  // Online sources are the appeals Favor marks as a source or ends with the -WS web variant; with none marked, every appeal is offered.
  source: `SELECT appeal_id AS code, appeal_description AS description FROM appeals WHERE COALESCE(appeal_inactive, 0) = 0 AND appeal_id IS NOT NULL
             AND (appeal_category LIKE '%ource%' OR appeal_id LIKE '%-WS') ORDER BY appeal_id`,
  fund: `SELECT fund_id AS code, fund_description AS description FROM funds WHERE COALESCE(fund_inactive, 0) = 0 AND fund_id IS NOT NULL ORDER BY fund_id`,
  campaign: `SELECT campaign_id AS code, campaign_description AS description FROM campaigns WHERE COALESCE(campaign_inactive, 0) = 0 AND campaign_id IS NOT NULL ORDER BY campaign_id`,
};

const COLUMN: Record<CodeKind, string> = { appeal: 'appeal_code', source: 'source_code', fund: 'fund_code', campaign: 'campaign_code' };

async function load(env: Env, kind: CodeKind): Promise<Code[]> {
  let rows = await mirror<{ code: string | null; description: string | null }>(env, SQL[kind]);
  if (kind === 'source' && !rows.length) rows = await mirror(env, SQL.appeal);
  return rows.filter((r) => r && r.code).map((r) => ({ code: String(r.code), description: String(r.description || '') }));
}

/** Codes typed on tasks before: the fallback when the mirror cannot be reached. */
async function recent(env: Env, kind: CodeKind): Promise<Code[]> {
  const col = COLUMN[kind];
  const r = await env.DB.prepare(`SELECT ${col} AS code, COUNT(*) AS n FROM hub_tasks WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC LIMIT 200`).all<{ code: string }>().catch(() => ({ results: [] as { code: string }[] }));
  return (r.results || []).map((x) => ({ code: x.code, description: '' }));
}

export interface CodesAnswer {
  codes: Code[];
  /** mirror: fresh from Blackbaud's tables. cache: the last good list, the mirror did not answer. recent: only codes already used on tasks. */
  from: 'mirror' | 'cache' | 'recent';
  /** True when the list is not Blackbaud's: the picker lets the person type a code. */
  typed: boolean;
}

export async function codesFor(env: Env, kind: CodeKind, q: string, limit = 50, now = Date.now()): Promise<CodesAnswer> {
  let list: Code[] | null = null;
  let from: CodesAnswer['from'] = 'mirror';
  const hit = cache.get(kind);
  if (hit && now - hit.at < TTL_MS) list = hit.codes;
  else {
    try {
      list = await load(env, kind);
      cache.set(kind, { at: now, codes: list });
    } catch (err) {
      console.error('[projects] codes', kind, err instanceof Error ? err.message : err);
      if (hit) {
        list = hit.codes;
        from = 'cache';
      }
    }
  }
  if (!list) {
    list = await recent(env, kind);
    from = 'recent';
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = words.length ? list.filter((c) => words.every((w) => `${c.code} ${c.description}`.toLowerCase().includes(w))) : list;
  // A code that starts with what was typed comes first.
  const first = (words[0] || '').toLowerCase();
  const sorted = first ? [...match].sort((a, b) => Number(b.code.toLowerCase().startsWith(first)) - Number(a.code.toLowerCase().startsWith(first))) : match;
  return { codes: sorted.slice(0, Math.max(1, Math.min(200, limit))), from, typed: from === 'recent' };
}
