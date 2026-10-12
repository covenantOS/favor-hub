// Partners by total giving. Replaces the saved query "Top Givers Test 2026" (1197) and the older top donor lists
// (460 and its yearly copies). One report with a minimum total and a period instead of one query per cut-off.
//
// Credit rule, the same as the query (soft credit option "Recipients"): the whole gift counts for each soft credit recipient,
// otherwise for the partner on the gift. The KPI dashboard counts only the credited part of a split gift. Recurring gift setups
// are left out and their payments count.
// Read only, from the mirror.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';
import { SQL_MARK, displayName, holderLabel, inChunks } from './lists-shared';

/** Parameters: ?1 first day, ?2 last day. */
const TOTALS_SQL =
  SQL_MARK('top-totals') +
  `WITH g AS (
  SELECT id, DATE(gift_date) AS d, gift_amount AS amt, constituent_record_id AS cid,
         CASE WHEN soft_credits IS NOT NULL AND json_valid(soft_credits) THEN soft_credits ELSE '[]' END AS sc
    FROM gifts
   WHERE gift_amount > 0 AND gift_type <> 'RecurringGift' AND gift_date IS NOT NULL AND DATE(gift_date) BETWEEN ?1 AND ?2
), cr AS (
  SELECT g.id AS gid, g.d AS d, g.amt AS a,
         CAST(json_extract(j.value, '$.constituent_id') AS TEXT) AS rid
    FROM g, json_each(g.sc) AS j WHERE json_extract(j.value, '$.constituent_id') IS NOT NULL
  UNION ALL
  SELECT g.id, g.d, g.amt, g.cid FROM g
   WHERE g.cid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(g.sc) AS j2 WHERE json_extract(j2.value, '$.constituent_id') IS NOT NULL)
)
SELECT rid, ROUND(SUM(a), 2) AS total, COUNT(*) AS n, MAX(d) AS last_d, MAX(a) AS big FROM cr GROUP BY rid HAVING SUM(a) >= ?3 ORDER BY total DESC, CAST(rid AS INTEGER)`;

const DETAIL_SQL =
  SQL_MARK('top-detail') +
  `SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.constituent_type AS type, c.first_name AS first, c.last_name AS last,
          c.organization_name AS org, c.spouse_first_name AS sf, c.spouse_last_name AS sl, a.address_city AS city, a.address_state AS state,
          COALESCE(c.inactive, 0) AS inactive, COALESCE(c.deceased, 0) AS deceased
   FROM constituents c LEFT JOIN addresses a ON a.id = c.primary_address_id
   WHERE c.id IN (SELECT value FROM json_each(?1))`;

const HOLD_SQL =
  SQL_MARK('top-holders') +
  `SELECT x.constituent_record_id AS cid, x.assignment_type AS type, f.fundraiser_first_name AS first, f.fundraiser_last_name AS last
   FROM assignments x LEFT JOIN fundraisers f ON f.id = x.assignment_fundraiser_id
   WHERE x.assignment_to_date IS NULL AND x.constituent_record_id IN (SELECT value FROM json_each(?1))`;

/** The same total counted a second way: gift credit per partner summed in one pass over the gifts table, for the partners at or above the cut-off. */
const COUNT_SQL =
  SQL_MARK('top-count') +
  `WITH cr AS (
  SELECT CAST(json_extract(j.value, '$.constituent_id') AS TEXT) AS rid,
         g.gift_amount AS a
    FROM gifts g, json_each(CASE WHEN g.soft_credits IS NOT NULL AND json_valid(g.soft_credits) THEN g.soft_credits ELSE '[]' END) AS j
   WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND DATE(g.gift_date) BETWEEN ?1 AND ?2 AND json_extract(j.value, '$.constituent_id') IS NOT NULL
  UNION ALL
  SELECT g.constituent_record_id, g.gift_amount FROM gifts g
   WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND DATE(g.gift_date) BETWEEN ?1 AND ?2 AND g.constituent_record_id IS NOT NULL
     AND NOT (g.soft_credits IS NOT NULL AND json_valid(g.soft_credits) AND g.soft_credits LIKE '%constituent_id%')
), t AS (SELECT rid, SUM(a) AS s FROM cr GROUP BY rid)
SELECT COUNT(*) AS n, COALESCE(SUM(s), 0) AS total FROM t WHERE s >= ?3`;

const addYears = (day: string, n: number) => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`;

export function windowFor(today: string, within: string): [string, string] {
  const y = Number(today.slice(0, 4));
  if (within === 'year') return [`${y}-01-01`, today];
  if (within === 'last') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  if (within === '12') return [addYears(today, -1), today];
  return ['1900-01-01', today];
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

interface Extra {
  independent: { n: number; total: number };
  window: [string, string];
}

const def: ReportDef = {
  id: 'top-partners',
  filters: [
    {
      id: 'min',
      label: 'Total giving at least',
      type: 'select',
      options: [
        ['10000', '$10,000'],
        ['25000', '$25,000'],
        ['30000', '$30,000'],
        ['50000', '$50,000'],
        ['100000', '$100,000'],
        ['250000', '$250,000'],
      ],
      def: '50000',
    },
    {
      id: 'within',
      label: 'Gifts counted',
      type: 'seg',
      options: [
        ['all', 'All time'],
        ['year', 'This year'],
        ['12', 'Last 12 months'],
        ['last', 'Last year'],
      ],
      def: 'all',
    },
    { id: 'who', label: 'Held by', type: 'text', def: '' },
  ],
  columns: [
    { key: 'lookup', label: 'Constituent ID', type: 'id' },
    { key: 'name', label: 'Partner', type: 'text' },
    { key: 'total', label: 'Total giving', type: 'money', total: true },
    { key: 'gifts', label: 'Gifts', type: 'int' },
    { key: 'big', label: 'Largest gift', type: 'money' },
    { key: 'last', label: 'Last gift', type: 'date' },
    { key: 'place', label: 'City, state', type: 'text' },
    { key: 'holder', label: 'Assigned to', type: 'text' },
    { key: 'status', label: 'Record', type: 'chip' },
  ],
  note: 'The same partners as the Top Givers saved query. A gift counts in full for each soft credit recipient, or for the partner on the gift when it has none, as Blackbaud totals it. The KPI dashboard counts only the credited part of a split gift, so a partner with a split soft credit shows more here. Recurring gift setups are left out and their payments count. Inactive and deceased records stay on the list, as they do in the query, and show in the Record column.',

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const min = Number(f.min) || 50000;
    const window = windowFor(ctx.today, f.within);
    const totals = await ctx.sql<{ rid: string; total: number; n: number; last_d: string; big: number }>(TOTALS_SQL, [window[0], window[1], min]);
    const ids = totals.map((t) => String(t.rid));
    const detail = (await inChunks(ids, (json) => ctx.sql<Row>(DETAIL_SQL, [json]))).reduce((m, r) => m.set(String(r.id), r), new Map<string, Row>());
    const holds = new Map<string, Row[]>();
    for (const h of await inChunks(ids, (json) => ctx.sql<Row>(HOLD_SQL, [json]))) {
      const k = String(h.cid);
      if (!holds.has(k)) holds.set(k, []);
      holds.get(k)!.push(h);
    }
    const who = f.who.trim().toLowerCase();
    let rows: Row[] = totals.map((t) => {
      const d = detail.get(String(t.rid)) || {};
      const place = [d.city, d.state].filter(Boolean).join(', ');
      return {
        id: String(t.rid),
        lookup: d.lookup ?? '',
        name: displayName({ type: d.type as string, first: d.first as string, last: d.last as string, org: d.org as string, sf: d.sf as string, sl: d.sl as string }),
        total: Number(t.total),
        gifts: Number(t.n),
        big: Number(t.big),
        last: String(t.last_d || ''),
        place,
        holder: holderLabel(holds.get(String(t.rid)) || []),
        status: Number(d.deceased) === 1 ? 'Deceased' : Number(d.inactive) === 1 ? 'Inactive' : '',
      } as Row;
    });
    const independent = (await ctx.sql<{ n: number; total: number }>(COUNT_SQL, [window[0], window[1], min]))[0] || { n: 0, total: 0 };
    const all = rows.length;
    if (who) rows = rows.filter((r) => String(r.holder).toLowerCase().includes(who));
    return { rows, extra: { independent: { n: Number(independent.n), total: Number(independent.total) }, window, all } as Extra & { all: number }, asOf: ctx.today };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as Extra & { all: number };
    return compare(
      'Gifts table, same window and cut-off (separate query, one pass over the gifts)',
      e.all,
      e.independent.n,
      'count',
      `Partners at or above the cut-off ${e.all}; gifts table ${e.independent.n}. No KPI figure exists for this list.`
    );
  },

  tiles(rows): Tile[] {
    const sum = rows.reduce((s, r) => s + Number(r.total), 0);
    return [
      { label: 'Partners', value: rows.length, kind: 'int' },
      { label: 'Total giving', value: Math.round(sum), kind: 'money' },
      { label: 'Held by no one', value: rows.filter((r) => !r.holder).length, kind: 'int' },
      { label: 'Inactive or deceased', value: rows.filter((r) => r.status).length, kind: 'int', sub: money(rows.filter((r) => r.status).reduce((s, r) => s + Number(r.total), 0)) },
    ];
  },

  fileTag: (f) => `${f.min}-${f.within}`,
};

export default def;
