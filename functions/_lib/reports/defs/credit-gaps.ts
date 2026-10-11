// Gifts with no fundraiser credit. Replaces three saved queries that check credit and assignment:
//   974  ZZZ - Gifts not Credited to a Fundraiser
//   1010 ZZZ - Major Donors without Fundraiser Assignment
//   1193 Blank PC gifts check
// One report with a list picker instead of one query each. The gift credit itself is applied by the morning run; this list
// shows what is still without it. Read only, from the mirror.
//
// The major partner list leaves out partners whose Patron field is filled in Blackbaud. The mirror does not hold that field, so
// those partners' lookup ids are stored as "<id>|patron" = "1" in rpt_edits (the repository holds no partner ids).
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';

/** Appeals the first list never counts (query 974). */
const SKIP_APPEALS = ['W200-RDGR', 'Z200-REIM', 'W200-GRAN'];
const SKIP_CATEGORIES = ['Acquisition', 'Book', 'Digital Newsletter', 'Direct Mail Appeal', 'Direct Mail Newsletter', 'E-blast', 'Event', 'Flyer', 'Foundation Gift', 'Media', 'Reactivation', 'Speaking Engagement', 'Special Mailout', 'TV'];
/** Appeal categories that mean a person asked for the gift (query 1193). */
const PERSONAL_CATEGORIES = [
  'Personal Contact', 'Portfolio', 'White Mail',
  'Director - Alastair Kerr', 'Director - Brad Cutsinger', 'Director - Brian Carr', 'Director - Carole Ward', 'Director - Celeste Paul',
  'Director - Curtis Wilson', 'Director - David Morton', 'Director - Esther Rittermann', 'Director - Isaac Middleton', 'Director - Josh Milliron',
  'Director - Richard Brown', 'Director - Ruth Rittermann', 'Director - Ryan McAdams', 'Director - Stephanie Brady', 'Director - Terry Goodman',
  'Director - Timothy Claiborne',
];

const q = (xs: string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ');

const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The date range a list asks for: the two credit lists look back to January 2025, the personal contact list looks at last month. */
export function rangeFor(today: string, f: Record<string, string>): [string, string] {
  if (f.when === 'custom') {
    const from = f.from || '2025-01-01';
    const to = f.to || today;
    return from <= to ? [from, to] : [to, from];
  }
  if (f.list === 'pc') {
    const end = addDays(today.slice(0, 8) + '01', -1);
    return [end.slice(0, 8) + '01', end];
  }
  return ['2025-01-01', today];
}

const NAME = (a: string) => `CASE WHEN ${a}.constituent_type = 'Organization' THEN COALESCE(${a}.organization_name, '')
  ELSE trim(COALESCE(${a}.first_name, '') || CASE WHEN COALESCE(${a}.middle_name, '') <> '' THEN ' ' || substr(${a}.middle_name, 1, 1) || '.' ELSE '' END || ' ' || COALESCE(${a}.last_name, '')) END`;

const NO_CREDIT = "(g0.fundraiser_credits IS NULL OR g0.fundraiser_credits IN ('', '[]', 'null'))";

/** Parameters: ?1 first day, ?2 last day, ?3 smallest gift, ?4 JSON list of lookup ids to leave out. */
export const ROWS_SQL = (list: string) => {
  const types = list === 'major' ? "AND g0.gift_type IN ('Donation', 'RecurringGiftPayment')" : '';
  // The appeal test runs on each split, as the saved queries do. A gift with no split counts for the first list only.
  const pass =
    list === 'gaps'
      ? `(s.appeal_id IS NULL OR s.appeal_id NOT IN (${q(SKIP_APPEALS)})) AND (s.appeal_category IS NULL OR s.appeal_category NOT IN (${q(SKIP_CATEGORIES)}))`
      : list === 'pc'
        ? `s.appeal_category IN (${q(PERSONAL_CATEGORIES)})`
        : '1 = 1';
  const needAppeal = list === 'pc' ? 'AND ap.gid IS NOT NULL' : list === 'gaps' ? 'AND (ap.gid IS NOT NULL OR NOT EXISTS (SELECT 1 FROM json_each(g.gs)))' : '';
  const holder = list === 'pc' ? "AND EXISTS (SELECT 1 FROM assignments hx JOIN fundraisers hf ON hf.id = hx.assignment_fundraiser_id WHERE hx.constituent_record_id = cr.rid AND hx.assignment_to_date IS NULL AND hf.fundraiser_type = 'Partner Care')" : '';
  const patron = list === 'major' ? 'AND k.constituent_lookup_id NOT IN (SELECT value FROM json_each(?4))' : '';
  return `WITH g AS (
  SELECT g0.id AS id, substr(g0.gift_date, 1, 10) AS d, g0.gift_amount AS amt, g0.gift_type AS gtype, g0.constituent_record_id AS cid,
         CASE WHEN g0.soft_credits IS NOT NULL AND json_valid(g0.soft_credits) THEN g0.soft_credits ELSE '[]' END AS sc,
         CASE WHEN g0.gift_splits IS NOT NULL AND json_valid(g0.gift_splits) THEN g0.gift_splits ELSE '[]' END AS gs
    FROM gifts g0
   WHERE substr(g0.gift_date, 1, 10) BETWEEN ?1 AND ?2 AND g0.gift_amount >= ?3 AND ${NO_CREDIT} ${types}
), ap AS (
  SELECT gid, group_concat(aid, ', ') AS appeal, group_concat(cat, ', ') AS category FROM (
    SELECT DISTINCT g.id AS gid, s.appeal_id AS aid, s.appeal_category AS cat FROM g, json_each(g.gs) AS sp
      LEFT JOIN appeals s ON s.id = CAST(json_extract(sp.value, '$.appeal_id') AS TEXT)
     WHERE ${pass}
     ORDER BY g.id, s.appeal_id)
   GROUP BY gid
), cr AS (
  ${
    list === 'pc'
      ? 'SELECT g.id AS gid, g.d AS d, g.amt AS amt, g.gtype AS gtype, g.cid AS giver, g.cid AS rid FROM g WHERE g.cid IS NOT NULL'
      : `SELECT g.id AS gid, g.d AS d, g.amt AS amt, g.gtype AS gtype, g.cid AS giver, CAST(json_extract(j.value, '$.constituent_id') AS TEXT) AS rid
    FROM g, json_each(g.sc) AS j WHERE json_extract(j.value, '$.constituent_id') IS NOT NULL
  UNION ALL
  SELECT g.id, g.d, g.amt, g.gtype, g.cid, g.cid FROM g
   WHERE g.cid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(g.sc) AS j2 WHERE json_extract(j2.value, '$.constituent_id') IS NOT NULL)`
  }
)
SELECT cr.gid AS gid, cr.d AS gdate, cr.amt AS amount, cr.gtype AS gtype, cr.rid AS rid, k.constituent_lookup_id AS lookup, ${NAME('k')} AS partner,
       CASE WHEN cr.giver <> cr.rid THEN ${NAME('gv')} ELSE '' END AS giver,
       ap.appeal AS appeal, ap.category AS category,
       trim(COALESCE(ad.address_city, '') || CASE WHEN COALESCE(ad.address_state, '') <> '' THEN ', ' || ad.address_state ELSE '' END) AS place,
       (SELECT group_concat(trim(COALESCE(hf.fundraiser_first_name, '') || ' ' || COALESCE(hf.fundraiser_last_name, '')), '; ')
          FROM assignments hx JOIN fundraisers hf ON hf.id = hx.assignment_fundraiser_id
         WHERE hx.constituent_record_id = cr.rid AND hx.assignment_to_date IS NULL) AS holder
  FROM cr
  JOIN g ON g.id = cr.gid
  JOIN constituents k ON k.id = cr.rid
  LEFT JOIN constituents gv ON gv.id = cr.giver
  LEFT JOIN addresses ad ON ad.id = k.primary_address_id
  LEFT JOIN ap ON ap.gid = cr.gid
 WHERE 1 = 1 ${needAppeal} ${holder} ${patron}
 ORDER BY cr.d, partner, cr.gid`;
};

const LABEL: Record<string, string> = { Donation: 'One-time gift', RecurringGift: 'Recurring gift (new)', RecurringGiftPayment: 'Recurring gift payment' };
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const r2 = (n: number) => Math.round(n * 100) / 100;

const patronIds = (edits: Record<string, string>): string[] =>
  Object.keys(edits).filter((k) => k.endsWith('|patron') && edits[k] === '1').map((k) => k.slice(0, -'|patron'.length));

interface Extra {
  from: string;
  to: string;
  gifts: number;
  withoutCredit: number;
  skipped: number;
  patronLeft: number;
}

/** Gifts with no credit whose every split sits on a skipped appeal or appeal category (first list). Parameters: ?1, ?2, ?3 as above. */
const SKIPPED_SQL = `SELECT COUNT(*) AS n FROM gifts g0
 WHERE substr(g0.gift_date, 1, 10) BETWEEN ?1 AND ?2 AND g0.gift_amount >= ?3 AND ${NO_CREDIT}
   AND json_valid(COALESCE(g0.gift_splits, '[]')) AND json_array_length(COALESCE(g0.gift_splits, '[]')) > 0
   AND NOT EXISTS (
     SELECT 1 FROM json_each(COALESCE(g0.gift_splits, '[]')) sp LEFT JOIN appeals s ON s.id = CAST(json_extract(sp.value, '$.appeal_id') AS TEXT)
      WHERE (s.appeal_id IS NULL OR s.appeal_id NOT IN (${q(SKIP_APPEALS)})) AND (s.appeal_category IS NULL OR s.appeal_category NOT IN (${q(SKIP_CATEGORIES)})))`;

const def: ReportDef = {
  id: 'credit-gaps',
  filters: [
    {
      id: 'list',
      label: 'List',
      type: 'seg',
      options: [
        ['gaps', 'Gifts with no credit'],
        ['major', 'Major gifts with no credit'],
        ['pc', 'Personal contact gifts, Partner Care'],
      ],
      def: 'gaps',
    },
    {
      id: 'when',
      label: 'Dates',
      type: 'seg',
      options: [
        ['list', "The list's own dates"],
        ['custom', 'Pick dates'],
      ],
      def: 'list',
    },
    { id: 'from', label: 'From', type: 'date', def: '', showWhen: { id: 'when', is: 'custom' } },
    { id: 'to', label: 'To', type: 'date', def: '', showWhen: { id: 'when', is: 'custom' } },
  ],
  columns: [
    { key: 'gdate', label: 'Gift date', type: 'date' },
    { key: 'lookup', label: 'Constituent ID', type: 'id' },
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'money' },
    { key: 'gtype', label: 'Gift type', type: 'text' },
    { key: 'appeal', label: 'Appeal IDs', type: 'text' },
    { key: 'category', label: 'Appeal category', type: 'text' },
    { key: 'giver', label: 'Soft credited from', type: 'text' },
    { key: 'place', label: 'City, state', type: 'text' },
    { key: 'holder', label: 'Assigned to', type: 'text' },
  ],
  editable: { keyOf: (row) => String(row.gid), columns: [] },
  note: 'Gifts with no fundraiser credit on the gift. The first list is every such gift from January 2025 except the appeals and appeal categories the saved query skips. The second is one-time and recurring gifts of $1,000 or more from January 2025, without partners on the patron list. The third is last month\'s personal contact, portfolio and white mail gifts on partners Partner Care holds. A gift split across appeals shows once with its appeals listed.',

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const [from, to] = rangeFor(ctx.today, f);
    const min = f.list === 'major' ? 1000 : f.list === 'pc' ? 0.01 : 0.01;
    const ids = patronIds(ctx.edits);
    const raw = await ctx.sql<Row>(ROWS_SQL(f.list), f.list === 'major' ? [from, to, min, JSON.stringify(ids)] : [from, to, min]);
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const r of raw) {
      const key = `${r.gid}|${r.rid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        gid: r.gid,
        gdate: String(r.gdate),
        lookup: r.lookup,
        partner: String(r.partner || '').trim(),
        amount: Number(r.amount),
        gtype: LABEL[String(r.gtype)] || String(r.gtype),
        appeal: r.appeal || '',
        category: r.category || '',
        giver: String(r.giver || '').trim(),
        place: String(r.place || '').trim(),
        holder: String(r.holder || ''),
      });
    }
    const independent = await ctx.sql<{ n: number }>(
      `SELECT COUNT(*) AS n FROM gifts g0 WHERE substr(g0.gift_date, 1, 10) BETWEEN ?1 AND ?2 AND g0.gift_amount >= ?3 AND ${NO_CREDIT}
         ${f.list === 'major' ? "AND g0.gift_type IN ('Donation', 'RecurringGiftPayment')" : ''}`,
      [from, to, min]
    );
    const skipped = f.list === 'gaps' ? Number((await ctx.sql<{ n: number }>(SKIPPED_SQL, [from, to, min]))[0]?.n) || 0 : 0;
    const extra: Extra = { from, to, gifts: new Set(rows.map((r) => String(r.gid))).size, withoutCredit: Number(independent[0]?.n) || 0, skipped, patronLeft: ids.length };
    return { rows, extra, asOf: ctx.today };
  },

  totals(rows) {
    const seen = new Set<string>();
    let s = 0;
    for (const r of rows) {
      const k = String(r.gid);
      if (seen.has(k)) continue;
      seen.add(k);
      s += Number(r.amount);
    }
    return { amount: r2(s) };
  },

  tie(_ctx, _rows, f, extra): TieOut {
    const e = extra as Extra;
    if (f.list !== 'gaps') {
      return {
        label: '',
        mine: e.gifts,
        kpi: null,
        kind: 'count',
        status: 'none',
        note: `${e.gifts} gifts of ${e.withoutCredit} with no credit in these dates meet this list's other rules. No KPI figure exists for this list.`,
      };
    }
    // The first list keeps every gift with no credit except those whose every split is on a skipped appeal, counted here separately.
    return compare(
      `Gifts table, ${e.from} to ${e.to}, every gift with no fundraiser credit (separate count)`,
      e.gifts + e.skipped,
      e.withoutCredit,
      'count',
      `${e.gifts} on the list plus ${e.skipped} on skipped appeals and appeal categories. No KPI figure exists for this list.`
    );
  },

  tiles(rows): Tile[] {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(String(r.gid), Number(r.amount));
    const sum = Array.from(seen.values()).reduce((a, b) => a + b, 0);
    return [
      { label: 'Gifts', value: seen.size, kind: 'int', sub: money(sum) },
      { label: 'Partners', value: new Set(rows.map((r) => String(r.lookup))).size, kind: 'int' },
      { label: 'Held by no one', value: rows.filter((r) => !r.holder).length, kind: 'int' },
    ];
  },

  fileTag: (f) => f.list || 'gaps',
};

export default def;
