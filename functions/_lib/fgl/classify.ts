// Which waiting gifts are acquisition first gifts. Shared by the First-gift letters page (lists them) and Receipts (holds them back),
// so one gift is never on both pages and never thanked twice.
//
// Definition, from the KPI dashboard's acquisition rule (Projects/KPI Dashboard/2026-10-12 Lapsed and LYBUNT by acquisition.md):
//   acquisition = a gift split coded to an appeal whose category is Acquisition (the K codes and X243-AQHQ, 93 appeals);
//   first gift  = the earliest credited gift of the partner's household under shared/giving.ts (soft credits count for the partner they
//                 name, spouses are one household, a RecurringGift schedule is not a gift). Same-day gifts break by the lower gift id.
// All reads are from the D1 mirror, which can be up to 12 hours behind. A gift the mirror does not hold yet is not classified.
import { givingForMany, type MirrorQ } from '../gifts/partner-giving';
import { softOf } from '../../../shared/giving';

export const ACQUISITION_CATEGORY = 'Acquisition';

/** The statement text the mirror refuses must not appear here (readOnly in work/repo.ts checks the same pattern). */
export const ACQ_GIFTS_SQL = `SELECT g.id AS id, g.constituent_record_id AS giver, g.soft_credits AS soft, g.gift_splits AS splits, g.gift_amount AS amount,
       substr(g.gift_date, 1, 10) AS date, g.gift_type AS type
  FROM gifts g WHERE g.id IN (SELECT value FROM json_each(?1)) AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift'`;

export const ACQ_APPEALS_SQL = `SELECT id AS id, appeal_id AS code FROM appeals WHERE appeal_category = '${ACQUISITION_CATEGORY}'`;

export interface AcqGift {
  giftId: string;
  /** The Acquisition appeal codes on the gift's splits, e.g. K254-GIFT. */
  appeals: string[];
  /** The partner records the gift is credited to. */
  credited: string[];
}

/** The appeal ids on a gift's splits. */
export function splitAppealIds(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) return [];
    return [...new Set(v.map((s: any) => (s && s.appeal_id != null ? String(s.appeal_id) : '')).filter(Boolean))];
  } catch {
    return [];
  }
}

/** The partners a gift is credited to: the soft-credited partners when there are any, else the record it sits on. */
export function creditedOf(giver: string, soft: string | null): string[] {
  const s = softOf(soft).map((x) => x.cid);
  return s.length ? [...new Set(s)] : [String(giver)];
}

const byDateThenId = (a: { date: string; id: string }, b: { date: string; id: string }): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.id) - Number(b.id);

/** Of these Blackbaud system gift ids, the ones coded to an Acquisition appeal that are also the credited partner's first gift. */
export async function acquisitionFirstGifts(q: MirrorQ, giftIds: string[], asOf?: string): Promise<Map<string, AcqGift>> {
  const out = new Map<string, AcqGift>();
  const ids = [...new Set(giftIds.map(String).filter((x) => /^\d{1,12}$/.test(x)))];
  if (!ids.length) return out;
  const [gifts, appeals] = await Promise.all([q(ACQ_GIFTS_SQL, [JSON.stringify(ids)]), q(ACQ_APPEALS_SQL)]);
  const code = new Map<string, string>(appeals.map((a: any) => [String(a.id), String(a.code || '')]));
  const coded = gifts
    .map((g: any) => ({ g, hits: splitAppealIds(g.splits).filter((a) => code.has(a)).map((a) => code.get(a) as string) }))
    .filter((x) => x.hits.length > 0);
  if (!coded.length) return out;
  const credited = [...new Set(coded.flatMap((x) => creditedOf(String(x.g.giver), x.g.soft)))];
  const giving = await givingForMany(q, credited, asOf);
  for (const { g, hits } of coded) {
    const who = creditedOf(String(g.giver), g.soft);
    const isFirst = who.some((c) => {
      const p = giving.get(c);
      if (!p || !p.gifts.length) return false;
      const first = [...p.gifts].sort(byDateThenId)[0];
      return first.id === String(g.id);
    });
    if (isFirst) out.set(String(g.id), { giftId: String(g.id), appeals: [...new Set(hits)], credited: who });
  }
  return out;
}
