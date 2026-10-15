// The partner layer: Favor's official partner rule, ported from the Favor Brain's semantic layer so the Lists page and the Brain
// count the same people. Source: covenantOS/favor-mcp src/data/credit.ts and src/ask/schema.ts (expandVirtual), commit 686134152688.
// The rule (KPI dashboard, re-nxt-cloud-sync src/kpi-builders/donor-kpis.js):
//   - a gift counts when it is over $0, dated, and is not a RecurringGift schedule (its payments count);
//   - soft credits replace the gift's own record, so a DAF or foundation gift counts for the partner soft-credited on it;
//   - spouses linked in Blackbaud are one household, keyed by the smaller record id;
//   - a household never receives more than the gift amount from one gift;
//   - a household is living when any member is neither deceased nor inactive.
// Changes from the Brain's text: last_gift_ly and zip are added to the households CTE, and the final SELECT lists the columns the
// snapshot stores. The counting rule is untouched; tests/lists-layer.test.mjs runs the Brain's own text and this one on one fixture
// and compares the counts.

import { notTestPartnerSql } from '../testpartners.ts';

export class Sql {
  params: unknown[] = [];
  v(value: unknown): string {
    this.params.push(value);
    return `?${this.params.length}`;
  }
  list(values: unknown[]): string {
    return `(SELECT value FROM json_each(${this.v(JSON.stringify(values.map((x) => (x == null ? null : String(x)))))}))`;
  }
}

const SOFT = `CASE WHEN g.soft_credits IS NULL OR g.soft_credits IN ('', '[]') THEN '[null]' ELSE g.soft_credits END`;

/** CTEs hh (record to household), head, raw and credit. credit has one row per gift and household: gid, d, hid, a. */
export function creditCtes(q: Sql, asOf: string): string {
  const a = q.v(asOf);
  return `
hh AS MATERIALIZED (
  SELECT cid, sid, spouse_head, alive, sp_ok,
         CASE WHEN sp_ok = 1 THEN CASE WHEN CAST(cid AS INTEGER) <= CAST(sid AS INTEGER) THEN cid ELSE sid END ELSE cid END AS hid
    FROM (SELECT c.id AS cid, c.spouse_id AS sid, COALESCE(c.spouse_is_head_of_household, 0) AS spouse_head,
                 CASE WHEN c.spouse_id IS NOT NULL AND EXISTS (SELECT 1 FROM constituents s WHERE s.id = c.spouse_id) THEN 1 ELSE 0 END AS sp_ok,
                 CASE WHEN COALESCE(c.deceased, 0) = 0 AND COALESCE(c.inactive, 0) = 0 THEN 1 ELSE 0 END AS alive
            FROM constituents c WHERE ${notTestPartnerSql('c.id')})),
head AS MATERIALIZED (
  SELECT hid,
         COALESCE(MAX(CASE WHEN spouse_head = 1 AND sp_ok = 1 THEN sid END), hid) AS pid,
         MAX(CASE WHEN cid <> hid THEN cid END) AS m2,
         COUNT(*) AS members, MAX(alive) AS alive
    FROM hh GROUP BY hid),
raw AS (
  SELECT g.id AS gid, DATE(g.gift_date) AS d, g.gift_amount AS amt,
         COALESCE(json_extract(sc.value, '$.constituent_id'), g.constituent_record_id) AS cid,
         COALESCE(json_extract(sc.value, '$.amount.value'), g.gift_amount) AS camt
    FROM gifts g
    LEFT JOIN json_each(${SOFT}) sc
   WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND g.gift_date IS NOT NULL AND DATE(g.gift_date) <= ${a}
     AND ${notTestPartnerSql('g.constituent_record_id')} AND ${notTestPartnerSql("COALESCE(json_extract(sc.value, '$.constituent_id'), g.constituent_record_id)")}),
credit AS MATERIALIZED (
  SELECT r.gid, r.d, COALESCE(h.hid, CAST(r.cid AS TEXT)) AS hid, MIN(MAX(r.amt), SUM(r.camt)) AS a
    FROM raw r LEFT JOIN hh h ON h.cid = CAST(r.cid AS TEXT)
   GROUP BY r.gid, COALESCE(h.hid, CAST(r.cid AS TEXT)))`;
}

export const NAME_SQL = (p: string) =>
  `COALESCE(NULLIF(${p}.organization_name, ''), json_extract(${p}.raw_json, '$.name'), trim(COALESCE(${p}.first_name, '') || ' ' || COALESCE(${p}.last_name, '')))`;

/** The households CTE (needs creditCtes first). `day` is the placeholder of the as-of date. */
export function householdsCte(day: string): string {
  return `
households AS (
  SELECT t.household_id, t.record_id, t.spouse_record_id, t.lookup_id, t.name, t.constituent_type, hp.city, hp.state, hp.zip, hp.country, t.alive,
         t.first_gift, t.last_gift, lg.credited AS last_gift_amount, t.largest_gift, t.lifetime, t.gifts, t.status, CASE WHEN t.largest_gift >= 1000 THEN 1 ELSE 0 END AS major, t.status_last_year, t.last_gift_ly,
         fa.code AS first_appeal_code, fa.cat AS first_appeal_category, la.code AS last_appeal_code, la.cat AS last_appeal_category
    FROM (SELECT c.hid AS household_id, hd.pid AS record_id, hd.m2 AS spouse_record_id, p.constituent_lookup_id AS lookup_id, ${NAME_SQL('p')} AS name, p.constituent_type AS constituent_type,
                 hd.alive AS alive, MIN(c.d) AS first_gift, MAX(c.d) AS last_gift, MAX(c.a) AS largest_gift, ROUND(SUM(c.a), 2) AS lifetime, COUNT(*) AS gifts,
                 CASE WHEN MAX(c.d) > date(${day}, '-12 months') THEN 'active' WHEN MAX(c.d) > date(${day}, '-24 months') THEN 'LYBUNT' ELSE 'lapsed' END AS status,
                 MAX(CASE WHEN c.d <= date(${day}, '-12 months') THEN c.d END) AS last_gift_ly,
                 CASE WHEN MAX(CASE WHEN c.d <= date(${day}, '-12 months') THEN c.d END) IS NULL THEN NULL WHEN MAX(CASE WHEN c.d <= date(${day}, '-12 months') THEN c.d END) > date(${day}, '-24 months') THEN 'active' WHEN MAX(CASE WHEN c.d <= date(${day}, '-12 months') THEN c.d END) > date(${day}, '-36 months') THEN 'LYBUNT' ELSE 'lapsed' END AS status_last_year
            FROM credit c LEFT JOIN head hd ON hd.hid = c.hid LEFT JOIN constituents p ON p.id = hd.pid GROUP BY c.hid) t
    LEFT JOIN (SELECT hid, gid, a AS credited, ROW_NUMBER() OVER (PARTITION BY hid ORDER BY d DESC, CAST(gid AS INTEGER) DESC) AS rn FROM credit) lg ON lg.hid = t.household_id AND lg.rn = 1
    LEFT JOIN (SELECT q.hid, ap.appeal_id AS code, ap.appeal_category AS cat FROM (SELECT hid, gid, ROW_NUMBER() OVER (PARTITION BY hid ORDER BY d ASC, CAST(gid AS INTEGER) ASC) AS rn FROM credit) q JOIN gifts g ON g.id = q.gid LEFT JOIN appeals ap ON ap.id = json_extract(g.gift_splits, '$[0].appeal_id') WHERE q.rn = 1) fa ON fa.hid = t.household_id
    LEFT JOIN (SELECT q.hid, ap.appeal_id AS code, ap.appeal_category AS cat FROM (SELECT hid, gid, ROW_NUMBER() OVER (PARTITION BY hid ORDER BY d DESC, CAST(gid AS INTEGER) DESC) AS rn FROM credit) q JOIN gifts g ON g.id = q.gid LEFT JOIN appeals ap ON ap.id = json_extract(g.gift_splits, '$[0].appeal_id') WHERE q.rn = 1) la ON la.hid = t.household_id
    LEFT JOIN (SELECT p.id AS pid, ad.address_city AS city, ad.address_state AS state, ad.address_postal_code AS zip, COALESCE(ad.address_country, 'United States') AS country
                 FROM constituents p LEFT JOIN addresses ad ON ad.id = (SELECT x.id FROM addresses x WHERE x.constituent_record_id = p.id AND COALESCE(x.is_inactive, 0) = 0 ORDER BY (x.id = p.primary_address_id) DESC, COALESCE(x.is_primary, 0) DESC, x.date_modified DESC LIMIT 1)) hp ON hp.pid = t.record_id)`;
}

/** The statement the snapshot runs on the mirror: every household that has given, as of one day. */
export function householdsSnapshotSql(asOf: string): { sql: string; params: unknown[] } {
  const q = new Sql();
  const day = q.v(asOf);
  const sql = `WITH ${creditCtes(q, asOf).trim()},${householdsCte(day)}
SELECT household_id, record_id, spouse_record_id, lookup_id, name, constituent_type, city, state, zip, country, alive, first_gift, last_gift, last_gift_amount, largest_gift, lifetime, gifts,
       status, major, status_last_year, last_gift_ly, first_appeal_code, first_appeal_category, last_appeal_code, last_appeal_category
  FROM households`;
  return { sql, params: q.params };
}

/** One row per gift and credited household, with what the gift list needs. */
export function giftRowsSnapshotSql(asOf: string): { sql: string; params: unknown[] } {
  const q = new Sql();
  const sql = `WITH ${creditCtes(q, asOf).trim()}
SELECT c.gid AS gift_id, c.hid AS household_id, c.d AS gift_date, ROUND(c.a, 2) AS credited, g.gift_amount AS amount, g.gift_type AS gift_type, g.gift_payment_method AS method,
       g.gift_splits AS splits, g.fundraiser_credits AS credits, g.soft_credits AS soft, g.constituent_record_id AS giver, g.acknowledgment_status AS ack, g.receipt_status AS receipt
  FROM credit c JOIN gifts g ON g.id = c.gid`;
  return { sql, params: q.params };
}
