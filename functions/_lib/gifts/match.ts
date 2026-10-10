// Matching a photo to a partner, the fund and appeal catalogs, and the duplicate guard. Partners come from the shared partner
// module (functions/_lib/work/partner.ts), the one the Work Center and the partner page read, so a partner reads the same
// everywhere. Everything here reads the D1 mirror, which keeps merged and deleted rows and is up to 12 hours old: the writer
// checks the partner again with one live Blackbaud read before it posts.
//
// Mirror rule: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete, drop, alter or
// create, so no column alias or comment in this file may contain those words.
import type { Env } from '../http';
import { searchPartners, mirrorQ, type Q } from '../work/partner';
import { blackbaudRepo, readOnly, type ActionsRepo, type PartnerHit } from '../work/repo';
import { newId } from '../http';
import { WHERE_NEEDED_MOST, parseJson, sha256Hex, type Dup, type GiftRow } from './store';

export interface Candidate {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  exact: boolean;
}

export interface FundOpt {
  id: string;
  code: string;
  name: string;
}

export interface AppealOpt {
  id: string;
  code: string;
  name: string;
  category: string;
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Names to try for a payer line: the whole line, then each person on "Harold & Judith Whitcomb" with the shared last name. */
export function nameQueries(payer: string): string[] {
  const clean = String(payer || '').replace(/\b(mr|mrs|ms|dr|rev|pastor)\.?\s/gi, ' ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < 3) return [];
  const out: string[] = [clean];
  const parts = clean.split(/\s*(?:&|\band\b|\/)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].split(' ').slice(-1)[0];
    for (const p of parts) {
      const toks = p.split(' ');
      out.push(toks.length === 1 ? `${toks[0]} ${last}` : p);
    }
  }
  const toks = clean.split(' ');
  if (toks.length >= 3 && parts.length === 1) out.push(`${toks[0]} ${toks[toks.length - 1]}`);
  return [...new Set(out)].slice(0, 4);
}

export function rankCandidates(payer: string, hits: PartnerHit[]): Candidate[] {
  const want = norm(payer);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const h of hits) {
    if (seen.has(h.cid) || h.deceased) continue;
    seen.add(h.cid);
    const n = norm(h.name);
    out.push({ cid: h.cid, lookup: h.lookup, name: h.name, place: h.place, exact: !!want && (n === want || want.includes(n) || n.includes(want)) });
  }
  out.sort((a, b) => Number(b.exact) - Number(a.exact));
  return out.slice(0, 6);
}

export async function candidatesFor(repo: ActionsRepo, q: Q, payer: string): Promise<Candidate[]> {
  const hits: PartnerHit[] = [];
  for (const query of nameQueries(payer)) {
    try {
      hits.push(...(await searchPartners(repo, q, query, undefined, 6)));
    } catch {
      /* the mirror answered badly; the person searches by hand */
    }
    if (hits.length >= 6) break;
  }
  return rankCandidates(payer, hits);
}

// ---------------------------------------------------------------- catalogs

let catalogAt = 0;
let catalog: { funds: FundOpt[]; appeals: AppealOpt[] } | null = null;

export async function loadCatalog(q: Q): Promise<{ funds: FundOpt[]; appeals: AppealOpt[] }> {
  if (catalog && Date.now() - catalogAt < 10 * 60_000) return catalog;
  const funds = await q<{ id: string; code: string; name: string }>(
    readOnly("SELECT id AS id, fund_id AS code, fund_description AS name FROM funds WHERE COALESCE(fund_inactive, 0) = 0 ORDER BY fund_description")
  );
  const appeals = await q<{ id: string; code: string; name: string; category: string }>(
    readOnly("SELECT id AS id, appeal_id AS code, appeal_description AS name, appeal_category AS category FROM appeals WHERE COALESCE(appeal_inactive, 0) = 0 ORDER BY appeal_id")
  );
  catalog = {
    funds: funds.map((f) => ({ id: String(f.id), code: f.code || '', name: f.name || f.code || '' })),
    appeals: appeals.map((a) => ({ id: String(a.id), code: a.code || '', name: a.name || '', category: a.category || '' })),
  };
  catalogAt = Date.now();
  return catalog;
}

/** The fund and appeal on the partner's most recent donation: the SOP's fallback when nothing came with the check. */
export async function lastGiftCoding(q: Q, partnerId: string): Promise<{ fundId: string; appealId: string; date: string } | null> {
  const rows = await q<{ splits: string | null; d: string }>(
    readOnly(
      `SELECT gift_splits AS splits, substr(gift_date, 1, 10) AS d FROM gifts
        WHERE constituent_record_id = ?1 AND gift_type = 'Donation' AND gift_amount > 0 ORDER BY gift_date DESC LIMIT 3`
    ),
    [partnerId]
  );
  for (const r of rows) {
    const s = parseJson<any[]>(r.splits, [])[0];
    if (s && s.appeal_id) return { fundId: String(s.fund_id || WHERE_NEEDED_MOST), appealId: String(s.appeal_id), date: r.d };
  }
  return null;
}

// ---------------------------------------------------------------- duplicates

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Three guards, in order. The same check number from the same partner for the same amount already in the hub (any deposit); the
 * same photo (sha-256) already filed; the same amount from the same partner within three weeks already in Blackbaud. Only the
 * first two are certain; the third is a question a person answers. The hub's own database enforces the first again at send time.
 */
export async function findDuplicate(env: Env, q: Q, g: GiftRow, imageSha: string | null): Promise<Dup | null> {
  if (g.dedupe_key) {
    const hit = await env.DB.prepare(
      `SELECT g.id, d.name FROM ge_gift g JOIN ge_deposit d ON d.id = g.deposit_id
        WHERE g.dedupe_key = ? AND g.id <> ? AND g.status <> 'removed' AND d.status <> 'removed' LIMIT 1`
    )
      .bind(g.dedupe_key, g.id)
      .first<{ id: string; name: string }>();
    if (hit) return { kind: 'hub', message: `Same check already entered in ${hit.name}.`, decision: null };
  }
  if (imageSha) {
    const hit = await env.DB.prepare(
      `SELECT d.name FROM ge_image i JOIN ge_gift g ON g.id = i.gift_id JOIN ge_deposit d ON d.id = g.deposit_id
        WHERE i.sha256 = ? AND i.gift_id <> ? AND g.status <> 'removed' AND d.status <> 'removed' LIMIT 1`
    )
      .bind(imageSha, g.id)
      .first<{ name: string }>();
    if (hit) return { kind: 'photo', message: `This photo was already filed in ${hit.name}.`, decision: null };
  }
  if (g.partner_id && g.amount_cents && g.gift_date) {
    try {
      const rows = await q<{ id: string; d: string }>(
        readOnly(
          `SELECT id AS id, substr(gift_date, 1, 10) AS d FROM gifts
            WHERE constituent_record_id = ?1 AND gift_amount = ?2 AND substr(gift_date, 1, 10) >= ?3 AND substr(gift_date, 1, 10) <= ?4
              AND gift_type = 'Donation' LIMIT 3`
        ),
        [g.partner_id, g.amount_cents / 100, addDays(g.gift_date, -21), addDays(g.gift_date, 21)]
      );
      if (rows.length) return { kind: 'blackbaud', message: `Blackbaud already has a ${money(g.amount_cents)} gift from this partner on ${rows[0].d}.`, decision: null };
    } catch {
      /* the mirror is unavailable; the other two guards still ran */
    }
  }
  return null;
}

export { blackbaudRepo, mirrorQ, newId, sha256Hex };
