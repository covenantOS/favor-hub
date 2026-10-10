// Active, LYBUNT and lapsed partners. Replaces the Active Partners, LYBUNT Partners, Lapsed Partners and Annual Givers queries.
//
// The three status lists use the KPI dashboard's own definition: partners counted by household (spouses once), active
// when a gift fell in the 12 months up to the as-of date, LYBUNT when the last gift was 12 to 24 months back, lapsed
// when it was older, and deceased or inactive households left out of LYBUNT and lapsed. The windows and the counts
// come from ctx.kpi().status. This file never counts those groups for the tie-out on its own.
import { compare, noTie } from '../tieout';
import type { ReportDef, Row, TieOut, Tile } from '../types';
import {
  CREDIT_ROWS_SQL,
  SQL_MARK,
  addMonths,
  buildHouseholds,
  countStatus,
  displayName,
  groupGiving,
  holderLabel,
  inChunks,
  statusOf,
  type Credit,
  type Con,
} from './lists-shared';

const LABEL: Record<string, string> = { active: 'Active', lybunt: 'LYBUNT', lapsed: 'Lapsed', annual: 'Annual giver' };

const CONS_SQL = SQL_MARK('constituents') + 'SELECT id, spouse_id, deceased, inactive FROM constituents';

const DETAIL_SQL =
  SQL_MARK('detail') +
  `SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.constituent_type AS type, c.first_name AS first, c.last_name AS last,
          c.organization_name AS org, c.spouse_first_name AS sf, c.spouse_last_name AS sl, a.address_city AS city, a.address_state AS state
   FROM constituents c LEFT JOIN addresses a ON a.id = c.primary_address_id
   WHERE c.id IN (SELECT value FROM json_each(?1))`;

const HOLD_SQL =
  SQL_MARK('holders') +
  `SELECT x.constituent_record_id AS cid, x.assignment_type AS type, f.fundraiser_first_name AS first, f.fundraiser_last_name AS last
   FROM assignments x LEFT JOIN fundraisers f ON f.id = x.assignment_fundraiser_id
   WHERE x.assignment_to_date IS NULL AND x.constituent_record_id IN (SELECT value FROM json_each(?1))`;

// Annual givers (query 1156): exactly one gift in each of the three 12-month windows ending on the as-of date,
// deceased and inactive left out. Parameters: ?1 as of, ?2 one year back, ?3 two years back, ?4 three years back.
const ANNUAL_SQL =
  SQL_MARK('annual') +
  `WITH g AS (
     SELECT id, DATE(gift_date) AS d, constituent_record_id AS cid,
            CASE WHEN soft_credits IS NOT NULL AND json_valid(soft_credits) THEN soft_credits ELSE '[]' END AS sc
     FROM gifts WHERE gift_type <> 'RecurringGift' AND gift_date IS NOT NULL AND DATE(gift_date) > ?4 AND DATE(gift_date) <= ?1
   ),
   cr AS (
     SELECT g.id AS gid, g.d AS d, CAST(json_extract(j.value, '$.constituent_id') AS TEXT) AS rid
     FROM g, json_each(g.sc) AS j WHERE json_extract(j.value, '$.constituent_id') IS NOT NULL
     UNION ALL
     SELECT g.id, g.d, g.cid FROM g WHERE g.cid IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM json_each(g.sc) AS j2 WHERE json_extract(j2.value, '$.constituent_id') IS NOT NULL)
   ),
   y AS (SELECT rid, SUM(d > ?2) AS y1, SUM(d > ?3 AND d <= ?2) AS y2, SUM(d <= ?3) AS y3 FROM cr GROUP BY rid)
   SELECT y.rid AS rid FROM y JOIN constituents c ON c.id = y.rid
   WHERE y.y1 = 1 AND y.y2 = 1 AND y.y3 = 1 AND COALESCE(c.inactive, 0) = 0 AND COALESCE(c.deceased, 0) = 0`;

interface Extra {
  group: string;
  asOf: string;
  t12: string;
  t24: string;
  counts: { active: number; lybunt: number; lapsed: number } | null;
  kpi: { active: number; lybunt: number; lapsed: number } | null;
  narrowed: boolean;
}

const def: ReportDef = {
  id: 'status',
  filters: [
    {
      id: 'group',
      label: 'Partners',
      type: 'seg',
      def: 'active',
      options: [
        ['active', 'Active'],
        ['lybunt', 'LYBUNT'],
        ['lapsed', 'Lapsed'],
        ['annual', 'Annual givers'],
      ],
    },
    { id: 'asof', label: 'As of', type: 'date', def: '', showWhen: { id: 'group', is: 'annual' } },
    { id: 'state', label: 'State', type: 'text', def: '' },
    { id: 'held', label: 'Held by', type: 'text', def: '' },
  ],
  columns: [
    { key: 'partner', label: 'Partner' },
    { key: 'lookup', label: 'Partner ID', type: 'id' },
    { key: 'type', label: 'Type' },
    { key: 'status', label: 'Status', type: 'chip' },
    { key: 'first', label: 'First gift', type: 'date' },
    { key: 'last', label: 'Last gift', type: 'date' },
    { key: 'lastAmt', label: 'Last gift amount', type: 'money' },
    { key: 'big', label: 'Largest gift', type: 'money' },
    { key: 'total', label: 'Total giving', type: 'money', total: true },
    { key: 'n', label: 'Gifts', type: 'int', total: true },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'held', label: 'Held by' },
  ],
  note: 'Counted by household with the KPI dashboard rule: active is a gift in the last 12 months, LYBUNT a last gift 12 to 24 months back, lapsed older than 24 months. Deceased and inactive households are left out of LYBUNT and lapsed. A gift credited to both spouses counts in each spouse total. Annual givers are partners with exactly one gift in each of the last three 12-month windows.',
  fileTag: (f) => f.group || 'active',

  async load(ctx, f) {
    const kpi = await ctx.kpi();
    const annual = f.group === 'annual';
    const asOf = annual ? f.asof || ctx.today : kpi?.status?.activeAfter && kpi.asOf ? kpi.asOf : ctx.today;
    const t12 = !annual && kpi?.status?.activeAfter ? kpi.status.activeAfter : addMonths(asOf, -12);
    const t24 = !annual && kpi?.status?.lapsedOnOrBefore ? kpi.status.lapsedOnOrBefore : addMonths(asOf, -24);

    const [credits, cons] = await Promise.all([ctx.sql<Credit>(CREDIT_ROWS_SQL, [asOf]), ctx.sql<Con>(CONS_SQL)]);
    const hh = buildHouseholds(cons);

    // Pick the partners for the chosen list.
    let picked: Array<{ key: string; members: string[]; first: string; last: string; lastAmt: number; big: number; total: number; n: number; status: string }> = [];
    let counts: Extra['counts'] = null;
    if (annual) {
      const ids = (await ctx.sql<{ rid: string }>(ANNUAL_SQL, [asOf, addMonths(asOf, -12), addMonths(asOf, -24), addMonths(asOf, -36)])).map((r) => String(r.rid));
      const byRid = new Map(credits.map((c) => [String(c.rid), c]));
      for (const rid of ids) {
        const c = byRid.get(rid);
        if (!c) continue;
        picked.push({ key: rid, members: [rid], first: c.first_d, last: c.last_d, lastAmt: Number(c.last_amt), big: Number(c.big), total: Number(c.total), n: Number(c.n), status: 'annual' });
      }
    } else {
      const giving = groupGiving(credits, hh);
      counts = countStatus(giving, t12, t24);
      for (const g of giving.values()) {
        const s = statusOf(g.last, g.living, t12, t24);
        if (s !== f.group) continue;
        picked.push({ key: g.hid, members: hh.members.get(g.hid) || [g.hid], first: g.first, last: g.last, lastAmt: g.lastAmt, big: g.big, total: g.total, n: g.n, status: s });
      }
    }

    // Names, places and who holds each partner.
    const ids = [...new Set(picked.flatMap((p) => p.members))];
    const [people, holds] = await Promise.all([
      inChunks(ids, (json) => ctx.sql<Row>(DETAIL_SQL, [json])),
      inChunks(ids, (json) => ctx.sql<Row>(HOLD_SQL, [json])),
    ]);
    const person = new Map(people.map((p) => [String(p.id), p]));
    const holdBy = new Map<string, Row[]>();
    for (const h of holds) {
      const k = String(h.cid);
      const list = holdBy.get(k);
      if (list) list.push(h);
      else holdBy.set(k, [h]);
    }

    const wantState = f.state.trim().toUpperCase();
    const wantHeld = f.held.trim().toLowerCase();
    const rows: Row[] = [];
    for (const p of picked) {
      const root = person.get(p.key) || person.get(p.members[0]) || {};
      const other = p.members.filter((m) => m !== String(root.id)).map((m) => person.get(m)).find(Boolean);
      const sf = root.sf || (other ? other.first : '');
      const sl = root.sl || (other ? other.last : '');
      const held = holderLabel(p.members.flatMap((m) => holdBy.get(m) || []));
      const state = String(root.state || '').trim();
      if (wantState && state.toUpperCase() !== wantState) continue;
      if (wantHeld && !held.toLowerCase().includes(wantHeld)) continue;
      rows.push({
        partner: displayName({ first: root.first as string, last: root.last as string, org: root.org as string, sf: sf as string, sl: sl as string }),
        lookup: root.lookup ?? '',
        type: root.type ?? '',
        status: LABEL[p.status],
        first: p.first,
        last: p.last,
        lastAmt: p.lastAmt,
        big: p.big,
        total: p.total,
        n: p.n,
        city: root.city ?? '',
        state,
        held,
      });
    }
    rows.sort((a, b) => String(a.partner).localeCompare(String(b.partner)));
    const extra: Extra = {
      group: f.group,
      asOf,
      t12,
      t24,
      counts,
      kpi: kpi?.status ? { active: kpi.status.active, lybunt: kpi.status.lybunt, lapsed: kpi.status.lapsed } : null,
      narrowed: Boolean(wantState || wantHeld),
    };
    return { rows, extra, asOf };
  },

  tiles(rows, f, extra): Tile[] {
    const e = extra as Extra;
    if (f.group === 'annual') return [{ label: 'Annual givers', value: rows.length, kind: 'int' }];
    const out: Tile[] = [];
    for (const k of ['active', 'lybunt', 'lapsed'] as const) {
      const mine = e.counts ? e.counts[k] : null;
      const kpi = e.kpi ? e.kpi[k] : null;
      out.push({ label: LABEL[k] + ' partners', value: mine ?? 0, kind: 'int', sub: kpi === null ? 'KPI dashboard not answering' : `KPI dashboard ${kpi.toLocaleString('en-US')}` });
    }
    return out;
  },

  async tie(_ctx, rows, f, extra): Promise<TieOut> {
    const e = extra as Extra;
    if (f.group === 'annual') return noTie('Annual givers has no figure on the KPI dashboard.');
    if (e.narrowed) return noTie('This list is narrowed by state or held by, so it is smaller than the KPI count.');
    const key = f.group as 'active' | 'lybunt' | 'lapsed';
    const kpi = e.kpi ? e.kpi[key] : null;
    return compare(`KPI dashboard, Executive, ${LABEL[key].toLowerCase()} partners (as of ${e.asOf})`, rows.length, kpi, 'count');
  },
};

export default def;
