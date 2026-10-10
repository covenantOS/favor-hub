// Partners added from Entry. Blackbaud has them at once; the mirror takes up to 12 hours. The hub keeps its own short list (act_new_partners)
// so the Entry row can be matched to the new partner and sent the same day.
import type { Env } from '../http';
import type { PartnerHit, ActionsRepo } from './repo';

export interface NewPartnerRow {
  cid: string;
  lookup: string | null;
  name: string;
  place: string | null;
  holder: string | null;
  created_by: string;
  created_at: string;
}

export async function newPartnersByIds(env: Env, ids: string[]): Promise<PartnerHit[]> {
  const want = [...new Set(ids.map(String))].slice(0, 80);
  if (!want.length) return [];
  const r = await env.DB.prepare(`SELECT cid, lookup, name, place, holder FROM act_new_partners WHERE cid IN (${want.map(() => '?').join(',')})`)
    .bind(...want)
    .all<NewPartnerRow>()
    .catch(() => ({ results: [] as NewPartnerRow[] }));
  return r.results.map((x) => ({ cid: String(x.cid), lookup: x.lookup || '', name: x.name, place: x.place || '', holders: x.holder ? [String(x.holder)] : [], deceased: false }));
}

/** The mirror's partners, plus any the hub added that the mirror has not read yet. */
export async function partnersWithNew(env: Env, repo: ActionsRepo, ids: string[]): Promise<PartnerHit[]> {
  const hits = await repo.partnersByIds(ids);
  const have = new Set(hits.map((h) => h.cid));
  const missing = ids.filter((i) => i && !have.has(String(i)));
  if (!missing.length) return hits;
  return hits.concat(await newPartnersByIds(env, missing));
}
