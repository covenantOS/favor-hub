// Reads for giving statements, from the Blackbaud copy (the mirror). SELECT only. The functions take the reader as an
// argument so a test can hand them an in-memory database with invented rows.
import { cents, type Names, type PartnerInfo, type RawGift, type RawSplit } from './rules';

export type Sql = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface PartnerHit {
  id: string;
  lookup: string;
  name: string;
  kind: string;
  place: string;
  gifts: number;
  last: string;
}

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function parse<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** The name on an envelope: "Ann and Bo Lee", "Ann Lee and Bo Fox", or the organization. */
export function addresseeOf(r: { org?: unknown; first?: unknown; last?: unknown; spouse_first?: unknown; spouse_last?: unknown; name?: unknown }): string {
  if (txt(r.org)) return txt(r.org);
  const first = txt(r.first);
  const last = txt(r.last);
  const sf = txt(r.spouse_first);
  const sl = txt(r.spouse_last);
  if (sf && (!sl || sl.toLowerCase() === last.toLowerCase())) return `${first} and ${sf} ${last}`.replace(/\s+/g, ' ').trim();
  if (sf) return `${first} ${last} and ${sf} ${sl}`.replace(/\s+/g, ' ').trim();
  return `${first} ${last}`.replace(/\s+/g, ' ').trim() || txt(r.name);
}

/** Find a partner by Blackbaud ID (the lookup or the system id) or by any part of a name. */
export async function findPartners(sql: Sql, query: string): Promise<PartnerHit[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const digits = /^\d+$/.test(q);
  const tokens = digits ? [] : q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const where = digits
    ? 'c.constituent_lookup_id = ?1 OR c.id = ?1'
    : tokens
        .map(
          (_, i) =>
            `lower(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'') || ' ' || COALESCE(c.organization_name,'') || ' ' || COALESCE(c.spouse_first_name,'') || ' ' || COALESCE(c.spouse_last_name,'')) LIKE ?${i + 1}`
        )
        .join(' AND ');
  const params = digits ? [q] : tokens.map((t) => `%${t.replace(/[%_]/g, '')}%`);
  const rows = await sql<Record<string, unknown>>(
    `SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.constituent_type AS kind, c.organization_name AS org, c.first_name AS first, c.last_name AS last,
            c.spouse_first_name AS spouse_first, c.spouse_last_name AS spouse_last,
            (SELECT a.address_city || ', ' || a.address_state FROM addresses a WHERE a.id = c.primary_address_id) AS place,
            (SELECT COUNT(*) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift') AS gifts,
            (SELECT MAX(substr(g.gift_date, 1, 10)) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift') AS lastgift
       FROM constituents c WHERE ${where}
      ORDER BY gifts DESC, lower(COALESCE(c.last_name, c.organization_name, '')) LIMIT 15`,
    params
  );
  return rows.map((r) => ({
    id: txt(r.id),
    lookup: txt(r.lookup),
    name: addresseeOf(r),
    kind: txt(r.kind),
    place: txt(r.place).replace(/^, |, $/g, ''),
    gifts: num(r.gifts),
    last: txt(r.lastgift),
  }));
}

interface PartnerRow {
  id: string;
  lookup: string | null;
  kind: string | null;
  org: string | null;
  first: string | null;
  last: string | null;
  spouse_first: string | null;
  spouse_last: string | null;
  lines: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  email: string | null;
}

/** Partners by system id, with the preferred address and the first live email. Ids not found are left out. */
export async function loadPartners(sql: Sql, ids: string[]): Promise<Map<string, PartnerInfo>> {
  const out = new Map<string, PartnerInfo>();
  if (!ids.length) return out;
  const rows = await sql<PartnerRow>(
    `SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.constituent_type AS kind, c.organization_name AS org, c.first_name AS first, c.last_name AS last,
            c.spouse_first_name AS spouse_first, c.spouse_last_name AS spouse_last,
            a.address_lines AS lines, a.address_city AS city, a.address_state AS state, a.address_postal_code AS zip, a.address_country AS country,
            (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = c.id AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> ''
              ORDER BY e.is_primary DESC, e.id LIMIT 1) AS email
       FROM constituents c LEFT JOIN addresses a ON a.id = c.primary_address_id
      WHERE c.id IN (SELECT value FROM json_each(?1))`,
    [JSON.stringify(ids)]
  );
  const codes = await sql<{ cid: string; code: string }>(
    `SELECT constituent_record_id AS cid, code_description AS code FROM constituent_codes WHERE COALESCE(is_inactive, 0) = 0 AND constituent_record_id IN (SELECT value FROM json_each(?1))`,
    [JSON.stringify(ids)]
  );
  const codeOf = new Map<string, string[]>();
  for (const c of codes) codeOf.set(String(c.cid), [...(codeOf.get(String(c.cid)) || []), txt(c.code)]);
  for (const r of rows) {
    const addressee = addresseeOf(r);
    out.set(String(r.id), {
      id: String(r.id),
      lookup: txt(r.lookup) || String(r.id),
      name: addressee,
      addressee,
      sortName: (txt(r.org) || `${txt(r.last)} ${txt(r.first)}`).toLowerCase(),
      organization: Boolean(txt(r.org)) || txt(r.kind) === 'Organization',
      addressLines: txt(r.lines).split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      city: txt(r.city),
      state: txt(r.state),
      zip: txt(r.zip),
      country: txt(r.country),
      email: txt(r.email),
      constituency: codeOf.get(String(r.id)) || [],
    });
  }
  return out;
}

interface GiftRow {
  id: string;
  lid: string | null;
  cid: string;
  amount: number;
  d: string;
  gtype: string;
  gstatus: string | null;
  pm: string | null;
  ref: string | null;
  anon: number | null;
  splits: string | null;
  soft: string | null;
}

/**
 * Every gift on these partners' own records, and every gift soft-credited to them, dated from `from` to `to`.
 * Recurring gift setups come back too (the rules leave them off) so a count can show what was left out.
 */
export async function loadGifts(sql: Sql, ids: string[], from: string, to: string): Promise<{ gifts: RawGift[]; names: Names }> {
  if (!ids.length) return { gifts: [], names: { fund: () => '', appealCategory: () => '' } };
  const list = JSON.stringify(ids);
  const cols = `g.id AS id, json_extract(g.raw_json, '$.lookup_id') AS lid, g.constituent_record_id AS cid, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS d,
                g.gift_type AS gtype, g.gift_status AS gstatus, g.gift_payment_method AS pm, json_extract(g.raw_json, '$.reference') AS ref,
                json_extract(g.raw_json, '$.is_anonymous') AS anon, g.gift_splits AS splits, g.soft_credits AS soft`;
  const own = await sql<GiftRow>(
    `SELECT ${cols} FROM gifts g WHERE g.constituent_record_id IN (SELECT value FROM json_each(?1)) AND substr(g.gift_date, 1, 10) >= ?2 AND substr(g.gift_date, 1, 10) <= ?3
      ORDER BY g.gift_date, g.id`,
    [list, from, to]
  );
  const soft = await sql<GiftRow>(
    `SELECT ${cols} FROM gifts g, json_each(g.soft_credits) sc
      WHERE substr(g.gift_date, 1, 10) >= ?2 AND substr(g.gift_date, 1, 10) <= ?3 AND g.soft_credits LIKE '[{%'
        AND json_extract(sc.value, '$.constituent_id') IN (SELECT value FROM json_each(?1))
      GROUP BY g.id`,
    [list, from, to]
  );
  const seen = new Set<string>();
  const rows: GiftRow[] = [];
  for (const r of [...own, ...soft]) {
    if (seen.has(String(r.id))) continue;
    seen.add(String(r.id));
    rows.push(r);
  }
  const funds = new Set<string>();
  const appeals = new Set<string>();
  const people = new Set<string>();
  const parsed = rows.map((r) => {
    const splits = parse<Array<{ amount?: { value?: number }; appeal_id?: string; fund_id?: string }>>(r.splits, []);
    const soft = parse<Array<{ constituent_id?: string; amount?: { value?: number } }>>(r.soft, []);
    for (const s of splits) {
      if (s.fund_id) funds.add(String(s.fund_id));
      if (s.appeal_id) appeals.add(String(s.appeal_id));
    }
    people.add(String(r.cid));
    return { r, splits, soft };
  });
  const [fundRows, appealRows, nameRows] = await Promise.all([
    funds.size ? sql<{ id: string; d: string }>(`SELECT id AS id, fund_description AS d FROM funds WHERE id IN (SELECT value FROM json_each(?1))`, [JSON.stringify([...funds])]) : Promise.resolve([]),
    appeals.size ? sql<{ id: string; c: string }>(`SELECT id AS id, appeal_category AS c FROM appeals WHERE id IN (SELECT value FROM json_each(?1))`, [JSON.stringify([...appeals])]) : Promise.resolve([]),
    sql<{ id: string; org: string | null; first: string | null; last: string | null }>(
      `SELECT id AS id, organization_name AS org, first_name AS first, last_name AS last FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`,
      [JSON.stringify([...people])]
    ),
  ]);
  const fundName = new Map(fundRows.map((f) => [String(f.id), txt(f.d)]));
  const appealCat = new Map(appealRows.map((a) => [String(a.id), txt(a.c)]));
  const who = new Map(nameRows.map((n) => [String(n.id), addresseeOf(n)]));
  const gifts: RawGift[] = parsed.map(({ r, splits, soft }) => {
    const rs: RawSplit[] = splits.map((s) => ({ cents: cents(s.amount?.value), fundId: txt(s.fund_id), appealId: txt(s.appeal_id) }));
    return {
      id: String(r.id),
      lookup: txt(r.lid) || String(r.id),
      giverId: String(r.cid),
      giverName: who.get(String(r.cid)) || '',
      date: txt(r.d),
      cents: cents(r.amount),
      type: txt(r.gtype),
      status: txt(r.gstatus),
      method: txt(r.pm),
      reference: txt(r.ref),
      anonymous: Boolean(r.anon),
      splits: rs,
      soft: soft.filter((s) => s.constituent_id).map((s) => ({ id: String(s.constituent_id), cents: cents(s.amount?.value) })),
    };
  });
  return { gifts, names: { fund: (id) => fundName.get(id) || '', appealCategory: (id) => appealCat.get(id) || '' } };
}
