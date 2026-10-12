// VERBATIM copy of the Favor Brain's partner layer, for the parity test (tests/lists-layer.test.mjs).
// Sources: covenantOS/favor-mcp src/data/credit.ts (creditCtes) and src/ask/schema.ts (expandVirtual), commit 686134152688, fetched 2026-10-12.
// Only TypeScript annotations were removed. If the Brain changes its rule, replace this file and the parity test shows whether the hub must follow.
export class Sql {
  constructor() { this.params = []; }
  v(value) { this.params.push(value); return `?${this.params.length}`; }
  list(values) { return `(SELECT value FROM json_each(${this.v(JSON.stringify(values.map((x) => (x == null ? null : String(x)))))}))`; }
}
export const NAME_SQL = (p) => `COALESCE(NULLIF(${p}.organization_name, ''), json_extract(${p}.raw_json, '$.name'), trim(COALESCE(${p}.first_name, '') || ' ' || COALESCE(${p}.last_name, '')))`;
export function creditCtes(q, asOf, opts = {}) {
  const SOFT_ = `CASE WHEN g.soft_credits IS NULL OR g.soft_credits IN ('', '[]') THEN '[null]' ELSE g.soft_credits END`;
	const a = q.v(asOf);
	let touch = "";
	if (opts.touching?.length) {
		const ids = q.list(opts.touching);
		touch = `AND (g.constituent_record_id IN ${ids} OR EXISTS (SELECT 1 FROM json_each(${SOFT_}) s WHERE json_extract(s.value, '$.constituent_id') IN ${ids}))`;
	}
	const added = opts.addedBy ? `AND (g.date_added IS NULL OR g.date_added <= ${q.v(opts.addedBy)})` : "";
	const w = opts.windowSql ? `CASE WHEN ${opts.windowSql} THEN 1 ELSE 0 END` : "0";
	return `
hh AS MATERIALIZED (
  SELECT cid, sid, spouse_head, alive, sp_ok,
         CASE WHEN sp_ok = 1 THEN CASE WHEN CAST(cid AS INTEGER) <= CAST(sid AS INTEGER) THEN cid ELSE sid END ELSE cid END AS hid
    FROM (SELECT c.id AS cid, c.spouse_id AS sid, COALESCE(c.spouse_is_head_of_household, 0) AS spouse_head,
                 CASE WHEN c.spouse_id IS NOT NULL AND EXISTS (SELECT 1 FROM constituents s WHERE s.id = c.spouse_id) THEN 1 ELSE 0 END AS sp_ok,
                 CASE WHEN COALESCE(c.deceased, 0) = 0 AND COALESCE(c.inactive, 0) = 0 THEN 1 ELSE 0 END AS alive
            FROM constituents c)),
head AS MATERIALIZED (
  SELECT hid,
         COALESCE(MAX(CASE WHEN spouse_head = 1 AND sp_ok = 1 THEN sid END), hid) AS pid,
         MAX(CASE WHEN cid <> hid THEN cid END) AS m2,
         COUNT(*) AS members, MAX(alive) AS alive
    FROM hh GROUP BY hid),
raw AS (
  SELECT g.id AS gid, DATE(g.gift_date) AS d, g.gift_amount AS amt, ${w} AS w,
         COALESCE(json_extract(sc.value, '$.constituent_id'), g.constituent_record_id) AS cid,
         COALESCE(json_extract(sc.value, '$.amount.value'), g.gift_amount) AS camt
    FROM gifts g
    LEFT JOIN json_each(${SOFT_}) sc
   WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND g.gift_date IS NOT NULL AND DATE(g.gift_date) <= ${a} ${touch} ${added}),
credit AS MATERIALIZED (
  SELECT r.gid, r.d, COALESCE(h.hid, CAST(r.cid AS TEXT)) AS hid, MIN(MAX(r.amt), SUM(r.camt)) AS a, MAX(r.w) AS w
    FROM raw r LEFT JOIN hh h ON h.cid = CAST(r.cid AS TEXT)
   GROUP BY r.gid, COALESCE(h.hid, CAST(r.cid AS TEXT)))`;
}

/** The Brain's households statement for one as-of date: [sql, params]. */
export function brainHouseholdsSql(asOf) {
  const sql = 'SELECT * FROM households';
  const q = new Sql();
  const day = q.v(asOf);
  const ctes = `${creditCtes(q, asOf)},
household_gifts AS (SELECT gid AS gift_id, d AS gift_date, hid AS household_id, a AS credited FROM credit),
household_holders AS (
  SELECT DISTINCT hh.hid AS household_id, x.assignment_fundraiser_id AS fundraiser_id, x.assignment_type AS assignment_type
    FROM assignments x JOIN hh ON hh.cid = x.constituent_record_id WHERE x.assignment_to_date IS NULL OR DATE(x.assignment_to_date) >= ${day}),
households AS (
  SELECT t.household_id, t.record_id, t.spouse_record_id, t.lookup_id, t.name, t.constituent_type, hp.city, hp.state, hp.country, t.alive,
         t.first_gift, t.last_gift, lg.credited AS last_gift_amount, t.largest_gift, t.lifetime, t.gifts, t.status, CASE WHEN t.largest_gift >= 1000 THEN 1 ELSE 0 END AS major, t.status_last_year, fa.code AS first_appeal_code, fa.cat AS first_appeal_category, la.code AS last_appeal_code, la.cat AS last_appeal_category
    FROM (SELECT c.hid AS household_id, hd.pid AS record_id, hd.m2 AS spouse_record_id, p.constituent_lookup_id AS lookup_id, ${NAME_SQL("p")} AS name, p.constituent_type AS constituent_type,
                 hd.alive AS alive, MIN(c.d) AS first_gift, MAX(c.d) AS last_gift, MAX(c.a) AS largest_gift, ROUND(SUM(c.a), 2) AS lifetime, COUNT(*) AS gifts,
                 CASE WHEN MAX(c.d) > date(${day}, '-12 months') THEN 'active' WHEN MAX(c.d) > date(${day}, '-24 months') THEN 'LYBUNT' ELSE 'lapsed' END AS status,
                 CASE WHEN MAX(CASE WHEN c.d <= date(${day}, '-12 months') THEN c.d END) IS NULL THEN NULL WHEN MAX(CASE WHEN c.d <= date(${day}, '-12 months') THEN c.d END) > date(${day}, '-24 months') THEN 'active' WHEN MAX(CASE WHEN c.d <= date(${day}, '-12 months') THEN c.d END) > date(${day}, '-36 months') THEN 'LYBUNT' ELSE 'lapsed' END AS status_last_year
            FROM credit c LEFT JOIN head hd ON hd.hid = c.hid LEFT JOIN constituents p ON p.id = hd.pid GROUP BY c.hid) t
    LEFT JOIN (SELECT hid, gid, a AS credited, ROW_NUMBER() OVER (PARTITION BY hid ORDER BY d DESC, CAST(gid AS INTEGER) DESC) AS rn FROM credit) lg ON lg.hid = t.household_id AND lg.rn = 1
    LEFT JOIN (SELECT q.hid, ap.appeal_id AS code, ap.appeal_category AS cat FROM (SELECT hid, gid, ROW_NUMBER() OVER (PARTITION BY hid ORDER BY d ASC, CAST(gid AS INTEGER) ASC) AS rn FROM credit) q JOIN gifts g ON g.id = q.gid LEFT JOIN appeals ap ON ap.id = json_extract(g.gift_splits, '$[0].appeal_id') WHERE q.rn = 1) fa ON fa.hid = t.household_id
    LEFT JOIN (SELECT q.hid, ap.appeal_id AS code, ap.appeal_category AS cat FROM (SELECT hid, gid, ROW_NUMBER() OVER (PARTITION BY hid ORDER BY d DESC, CAST(gid AS INTEGER) DESC) AS rn FROM credit) q JOIN gifts g ON g.id = q.gid LEFT JOIN appeals ap ON ap.id = json_extract(g.gift_splits, '$[0].appeal_id') WHERE q.rn = 1) la ON la.hid = t.household_id
    LEFT JOIN (SELECT p.id AS pid, ad.address_city AS city, ad.address_state AS state, COALESCE(ad.address_country, 'United States') AS country
                 FROM constituents p LEFT JOIN addresses ad ON ad.id = (SELECT x.id FROM addresses x WHERE x.constituent_record_id = p.id AND COALESCE(x.is_inactive, 0) = 0 ORDER BY (x.id = p.primary_address_id) DESC, COALESCE(x.is_primary, 0) DESC, x.date_modified DESC LIMIT 1)) hp ON hp.pid = t.record_id)`;
  return { sql: `WITH ${ctes}
${sql}`, params: q.params };
}
