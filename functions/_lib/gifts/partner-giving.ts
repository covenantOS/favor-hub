// One partner's giving from the mirror, by the rule in shared/giving.ts (the KPI dashboard's and the Favor Brain's rule).
// Every page that shows a partner's lifetime giving, last gift, largest gift, this year or the last 12 months reads it from here:
// the hover card (hub/entity.ts), the partner page (work/partner.ts), and the tie-out script (scripts/giving-tieout.mjs).
import { givingOf, kindOf, type Giving, type GiftRow } from '../../../shared/giving';

export type MirrorQ = (sql: string, params?: unknown[]) => Promise<any[]>;

export interface Member {
  id: string;
  name: string;
  relation: 'self' | 'spouse';
}

export interface PartnerGiving extends Giving {
  id: string;
  /** The household key: the smaller record id of a linked couple, else the record's own id. */
  household: string;
  members: Member[];
  /** Each member's own credited giving by the same rule (one record, not the pair). Set only when the household has two or more records. */
  byMember?: { id: string; giving: Giving }[];
}

const NAME = `COALESCE(NULLIF(organization_name, ''), json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')))`;

export function todayEt(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The household's record ids, with the KPI builder's key: spouses whose spouse record exists are one household keyed by the smaller id. */
export async function householdOf(q: MirrorQ, id: string): Promise<{ household: string; members: Member[] } | null> {
  const self = (await q(`SELECT id, spouse_id AS sid FROM constituents WHERE id = ?1`, [id]))[0];
  if (!self) return null;
  const sp = self.sid ? String(self.sid) : '';
  const ids = [id, sp].filter(Boolean);
  const marks = ids.map((_, i) => `?${i + 1}`).join(', ');
  const rows = await q(`SELECT id, spouse_id AS sid, ${NAME} AS name FROM constituents WHERE id IN (${marks}) OR spouse_id IN (${marks})`, ids);
  const exists = new Set(rows.map((r: any) => String(r.id)));
  // A spouse id may point at a record outside this set (a third record); look those up so the key matches the KPI builder's.
  const outside = [...new Set(rows.map((r: any) => (r.sid ? String(r.sid) : '')).filter((s) => s && !exists.has(s)))];
  if (outside.length) {
    const more = await q(`SELECT id FROM constituents WHERE id IN (${outside.map((_, i) => `?${i + 1}`).join(', ')})`, outside);
    for (const r of more) exists.add(String(r.id));
  }
  const hidOf = (r: any) => {
    const a = String(r.id);
    const b = r.sid ? String(r.sid) : '';
    if (!b || !exists.has(b)) return a;
    return Number(a) <= Number(b) ? a : b;
  };
  const selfRow = rows.find((r: any) => String(r.id) === id);
  const household = hidOf(selfRow);
  const members = rows
    .filter((r: any) => hidOf(r) === household)
    .map((r: any): Member => ({ id: String(r.id), name: String(r.name || `Record ${r.id}`), relation: String(r.id) === id ? 'self' : 'spouse' }))
    .sort((a, b) => (a.relation === 'self' ? -1 : b.relation === 'self' ? 1 : 0));
  return { household, members };
}

/** Every gift that sits on a member's record or names a member in its soft credits, in the shape shared/giving.ts reads. */
export async function giftRowsOf(q: MirrorQ, ids: string[]): Promise<GiftRow[]> {
  if (!ids.length) return [];
  const own = ids.map((_, i) => `?${i + 1}`).join(', ');
  const like = ids.map((_, i) => `soft_credits LIKE ?${ids.length + i + 1}`).join(' OR ');
  const rows = await q(
    `SELECT id, gift_amount AS amount, substr(gift_date, 1, 10) AS date, gift_type AS type, constituent_record_id AS giver, soft_credits AS soft
       FROM gifts
      WHERE gift_amount > 0 AND gift_type <> 'RecurringGift' AND gift_date IS NOT NULL
        AND (constituent_record_id IN (${own}) OR ${like})`,
    [...ids, ...ids.map((i) => `%"constituent_id":"${i}"%`)]
  );
  return rows.map((r: any) => ({ id: String(r.id), amount: Number(r.amount) || 0, date: String(r.date || ''), type: String(r.type || ''), giver: String(r.giver || ''), soft: r.soft == null ? null : String(r.soft) }));
}

/** Names and kinds (DAF, foundation, business, church) of the records gifts came through. */
export async function throughNames(q: MirrorQ, ids: string[]): Promise<Map<string, { name: string; kind: string }>> {
  const out = new Map<string, { name: string; kind: string }>();
  const list = [...new Set(ids.filter(Boolean))].slice(0, 90);
  if (!list.length) return out;
  const marks = list.map((_, i) => `?${i + 1}`).join(', ');
  const [rows, codes] = await Promise.all([
    q(`SELECT id, ${NAME} AS name, COALESCE(NULLIF(organization_name, ''), '') AS org FROM constituents WHERE id IN (${marks})`, list),
    q(`SELECT constituent_record_id AS cid, code_description AS code FROM constituent_codes WHERE constituent_record_id IN (${marks})`, list).catch(() => []),
  ]);
  const byId = new Map<string, string[]>();
  for (const c of codes) byId.set(String(c.cid), [...(byId.get(String(c.cid)) || []), String(c.code || '')]);
  for (const r of rows) out.set(String(r.id), { name: String(r.name || `Record ${r.id}`), kind: kindOf(byId.get(String(r.id)) || [], !!r.org) });
  return out;
}

/** The partner's household giving. Null when the record is not in the mirror. */
export async function partnerGiving(q: MirrorQ, id: string, asOf = todayEt()): Promise<PartnerGiving | null> {
  const hh = await householdOf(q, id);
  if (!hh) return null;
  const ids = hh.members.map((m) => m.id);
  const members = new Set(ids);
  const rows = await giftRowsOf(q, ids);
  const via = rows.filter((g) => !members.has(g.giver) && g.soft).map((g) => g.giver);
  const names = await throughNames(q, via);
  const out: PartnerGiving = { id, household: hh.household, members: hh.members, ...givingOf(rows, members, names, asOf) };
  if (ids.length > 1) out.byMember = ids.map((m) => ({ id: m, giving: givingOf(rows, new Set([m]), names, asOf) }));
  return out;
}

/**
 * The same figures for many partners at once (lists, Today, Gifts to thank): three mirror reads however many partners.
 * Returns a map from each asked id to its household giving. An id the mirror lacks is left out.
 */
export async function givingForMany(q: MirrorQ, idsIn: string[], asOf = todayEt()): Promise<Map<string, PartnerGiving>> {
  const out = new Map<string, PartnerGiving>();
  const ids = [...new Set(idsIn.map(String).filter((x) => /^\d{1,12}$/.test(x)))];
  if (!ids.length) return out;
  const list = JSON.stringify(ids);
  // Every record that can share a household with an asked id: the id, its spouse, and records naming either as spouse.
  const base = await q(
    `SELECT id, spouse_id AS sid, ${NAME} AS name FROM constituents
      WHERE id IN (SELECT value FROM json_each(?1)) OR spouse_id IN (SELECT value FROM json_each(?1))
         OR id IN (SELECT spouse_id FROM constituents WHERE id IN (SELECT value FROM json_each(?1)) AND spouse_id IS NOT NULL)`,
    [list]
  );
  const rec = new Map<string, any>(base.map((r: any) => [String(r.id), r]));
  const spouseIds = [...new Set(base.map((r: any) => (r.sid ? String(r.sid) : '')).filter((s) => s && !rec.has(s)))];
  const exists = new Set(rec.keys());
  if (spouseIds.length) for (const r of await q(`SELECT id FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`, [JSON.stringify(spouseIds)])) exists.add(String(r.id));
  const hidOf = (r: any) => {
    const a = String(r.id);
    const b = r.sid ? String(r.sid) : '';
    return !b || !exists.has(b) ? a : Number(a) <= Number(b) ? a : b;
  };
  const byHid = new Map<string, any[]>();
  for (const r of base) {
    const h = hidOf(r);
    byHid.set(h, [...(byHid.get(h) || []), r]);
  }
  const allMembers = [...new Set(base.map((r: any) => String(r.id)))];
  const rows = (
    await q(
      `SELECT id, gift_amount AS amount, substr(gift_date, 1, 10) AS date, gift_type AS type, constituent_record_id AS giver, soft_credits AS soft
         FROM gifts g
        WHERE gift_amount > 0 AND gift_type <> 'RecurringGift' AND gift_date IS NOT NULL
          AND (constituent_record_id IN (SELECT value FROM json_each(?1))
               OR (soft_credits IS NOT NULL AND soft_credits NOT IN ('', '[]')
                   AND EXISTS (SELECT 1 FROM json_each(g.soft_credits) s WHERE json_extract(s.value, '$.constituent_id') IN (SELECT value FROM json_each(?1)))))`,
      [JSON.stringify(allMembers)]
    )
  ).map((r: any): GiftRow => ({ id: String(r.id), amount: Number(r.amount) || 0, date: String(r.date || ''), type: String(r.type || ''), giver: String(r.giver || ''), soft: r.soft == null ? null : String(r.soft) }));
  const names = await throughNames(q, rows.filter((g) => g.soft && !rec.has(g.giver)).map((g) => g.giver));
  const softIds = (g: GiftRow) => {
    try {
      return (JSON.parse(g.soft || '[]') as any[]).map((s) => String(s?.constituent_id ?? ''));
    } catch {
      return [];
    }
  };
  const cache = new Map<string, Omit<PartnerGiving, 'id'>>();
  for (const id of ids) {
    const r = rec.get(id);
    if (!r) continue;
    const h = hidOf(r);
    let g = cache.get(h);
    if (!g) {
      const mem = (byHid.get(h) || [r]).map((m: any) => String(m.id));
      const set = new Set(mem);
      const mine = rows.filter((x) => set.has(x.giver) || softIds(x).some((c) => set.has(c)));
      g = { household: h, members: [], ...givingOf(mine, set, names, asOf) };
      cache.set(h, g);
    }
    const members: Member[] = (byHid.get(h) || [r]).map((m: any) => ({ id: String(m.id), name: String(m.name || `Record ${m.id}`), relation: String(m.id) === id ? 'self' : 'spouse' }));
    out.set(id, { id, ...g, members });
  }
  return out;
}
