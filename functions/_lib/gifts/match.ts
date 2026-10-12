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
import { amountIn, comingGift, expectedFits, type Expected } from './code';

export interface Candidate {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  exact: boolean;
  /** The city and state on the partner's record appear in the address printed on the check. */
  addr?: boolean;
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

/** The partner's "City, ST" against the address line the readers took from the check. */
export function addressMatches(address: string | null | undefined, place: string | null | undefined): boolean {
  const a = ` ${String(address || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  const [city, state] = String(place || '').split(',').map((x) => x.trim().toUpperCase().replace(/[^A-Z0-9 ]+/g, ''));
  if (!city || a.trim().length < 6) return false;
  if (!a.includes(` ${city} `)) return false;
  return !state || a.includes(` ${state} `);
}

export function rankCandidates(payer: string, hits: PartnerHit[], address?: string | null): Candidate[] {
  const want = norm(payer);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const h of hits) {
    if (seen.has(h.cid) || h.deceased) continue;
    seen.add(h.cid);
    const n = norm(h.name);
    out.push({ cid: h.cid, lookup: h.lookup, name: h.name, place: h.place, exact: !!want && (n === want || want.includes(n) || n.includes(want)), addr: addressMatches(address, h.place) });
  }
  out.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(!!b.addr) - Number(!!a.addr));
  return out.slice(0, 6);
}

export async function candidatesFor(repo: ActionsRepo, q: Q, payer: string, address?: string | null): Promise<Candidate[]> {
  const hits: PartnerHit[] = [];
  for (const query of nameQueries(payer)) {
    try {
      hits.push(...(await searchPartners(repo, q, query, undefined, 6)));
    } catch {
      /* the mirror answered badly; the person searches by hand */
    }
    if (hits.length >= 6) break;
  }
  return rankCandidates(payer, hits, address);
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

/** One donation per row in the twelve months before the gift date, not counting the gift itself. A partner with three or more is a frequent giver. */
export async function recentGiftCount(q: Q, partnerId: string, onDate: string): Promise<number> {
  const from = new Date(Date.parse(onDate + 'T12:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
  try {
    const rows = await q<{ n: number }>(
      readOnly(
        `SELECT COUNT(*) AS n FROM gifts WHERE constituent_record_id = ?1 AND gift_type = 'Donation' AND gift_amount > 0
            AND substr(gift_date, 1, 10) >= ?2 AND substr(gift_date, 1, 10) < ?3`
      ),
      [partnerId, from, onDate]
    );
    return Number(rows[0] && rows[0].n) || 0;
  } catch {
    return 0;
  }
}

/**
 * Gifts someone logged as coming for this partner: an opportunity with an expected date near the gift, or an action in the last two
 * months whose words say a gift or pledge was expected. Only the ones that fit the amount and the timing are returned.
 */
export async function expectedFor(q: Q, partnerId: string, giftDate: string, amountCents: number | null): Promise<Expected[]> {
  const day = 86400000;
  const from = new Date(Date.parse(giftDate + 'T12:00:00Z') - 60 * day).toISOString().slice(0, 10);
  const to = new Date(Date.parse(giftDate + 'T12:00:00Z') + 42 * day).toISOString().slice(0, 10);
  const out: Expected[] = [];
  try {
    const opps = await q<{ id: string; amt: number | null; d: string; purpose: string | null; name: string | null }>(
      readOnly(
        `SELECT id AS id, expected_amount AS amt, substr(expected_date, 1, 10) AS d, purpose AS purpose, name AS name FROM opportunities
          WHERE constituent_record_id = ?1 AND COALESCE(inactive, 0) = 0 AND expected_date IS NOT NULL AND substr(expected_date, 1, 10) >= ?2 AND substr(expected_date, 1, 10) <= ?3 LIMIT 5`
      ),
      [partnerId, from, to]
    );
    for (const o of opps) out.push({ id: o.id, kind: 'opportunity', date: o.d, amountCents: o.amt != null ? Math.round(Number(o.amt) * 100) : null, purpose: o.purpose || o.name || null, text: o.name || '' });
  } catch {
    /* the mirror has no opportunities yet; the other evidence still counts */
  }
  try {
    // The partner's calls, visits and notes in the two months before the gift (emails and mailings carry Favor's own wording, so they are
    // left out). The words are read here, not in the statement: a note counts when one of its sentences says a gift is coming (comingGift).
    const WHEN = "substr(COALESCE(action_completed_date, action_date_due, date_added), 1, 10)";
    const acts = await q<{ id: string; d: string; s: string | null; t: string | null; cat: string | null; fr: string | null }>(
      readOnly(
        `SELECT id AS id, ${WHEN} AS d, action_summary AS s, action_description AS t, action_category AS cat, json_extract(raw_json, '$.fundraisers') AS fr FROM actions
          WHERE constituent_record_id = ?1 AND ${WHEN} >= ?2 AND ${WHEN} <= ?3
            AND length(COALESCE(action_summary, '') || COALESCE(action_description, '')) > 12
            AND COALESCE(action_category, '') NOT IN ('Email', 'Mailing')
          ORDER BY ${WHEN} DESC LIMIT 25`
      ),
      [partnerId, from, giftDate]
    );
    const found: (Expected & { fid: string })[] = [];
    for (const a of acts) {
      const text = `${a.s || ''}. ${a.t || ''}`.replace(/\s+/g, ' ').trim().slice(0, 1200);
      const said = comingGift(text);
      if (!said) continue;
      const cents = amountIn(said);
      const fids = parseJson<any[]>(a.fr, []);
      found.push({ id: a.id, kind: 'action', date: a.d, amountCents: cents, purpose: null, text: text.slice(0, 400), category: a.cat, said, who: null, fid: fids.length ? String(fids[0]) : '' });
      if (found.length >= 5) break;
    }
    const fids = [...new Set(found.map((f) => f.fid).filter(Boolean))];
    const names = new Map<string, string>();
    if (fids.length) {
      const rows = await q<{ id: string; first: string | null; last: string | null }>(
        readOnly('SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers WHERE id IN (SELECT value FROM json_each(?1))'),
        [JSON.stringify(fids)]
      ).catch(() => []);
      for (const r of rows) names.set(String(r.id), `${r.first || ''} ${r.last || ''}`.trim());
    }
    for (const { fid, ...e } of found) out.push({ ...e, who: names.get(fid) || null });
  } catch {
    /* no actions to read */
  }
  return out.filter((e) => expectedFits(e, amountCents, giftDate));
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
