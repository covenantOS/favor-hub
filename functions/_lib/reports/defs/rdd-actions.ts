// RDD and church engagement actions, one row per completed action with the tags the directors type in. Replaces the
// saved query "RDD Action Reporting" (718). The KPI dashboard's RDD tab counts these actions; this list shows the rows
// behind the counts, with the same columns the query gives, and exports them.
//
// The saved query leaves out a handful of partner records (staff and family records whose actions are not counted).
// Their lookup ids are stored as "<id>|leave_out" = "1" in rpt_edits, so the repository holds no partner ids.
// Read only, from the mirror.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';

const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The completed-date range a preset asks for. */
export function rangeFor(today: string, f: Record<string, string>): [string, string] {
  const first = today.slice(0, 8) + '01';
  if (f.when === 'last-month') {
    const end = addDays(first, -1);
    return [end.slice(0, 8) + '01', end];
  }
  if (f.when === '30') return [addDays(today, -29), today];
  if (f.when === 'custom') {
    const from = f.from || first;
    const to = f.to || today;
    return from <= to ? [from, to] : [to, from];
  }
  return [first, today];
}

const TYPES: Record<string, string[]> = {
  both: ['RDD Action', 'CED Action'],
  rdd: ['RDD Action'],
  ced: ['CED Action'],
};

const NAME = `CASE WHEN c.constituent_type = 'Organization' THEN COALESCE(c.organization_name, '')
  ELSE trim(COALESCE(c.first_name, '') || CASE WHEN COALESCE(c.middle_name, '') <> '' THEN ' ' || substr(c.middle_name, 1, 1) || '.' ELSE '' END || ' ' || COALESCE(c.last_name, '')) END`;

/** Parameters: ?1 first day, ?2 last day completed. */
export const ROWS_SQL = (set: string) => `SELECT a.id AS id, a.action_category AS category, substr(a.action_date_due, 1, 10) AS adate, substr(a.action_completed_date, 1, 10) AS done,
       a.action_fundraiser_id AS frs, a.action_type AS atype, c.constituent_lookup_id AS lookup, ${NAME} AS partner,
       t.action_ask_amount AS ask, t.action_referrals AS referrals, t.texted AS texted, t.thanked AS thanked, t.scheduling AS scheduling,
       t.attended_Hosted AS ah, t.presented AS presented, t.stewardship AS stewardship
  FROM actions a
  JOIN constituents c ON c.id = a.constituent_record_id
  LEFT JOIN action_tags t ON t.id = a.id
 WHERE a.action_type IN (${(TYPES[set] || TYPES.both).map((x) => `'${x}'`).join(', ')}) AND substr(a.action_completed_date, 1, 10) BETWEEN ?1 AND ?2
 ORDER BY a.action_date_due, CAST(a.id AS INTEGER)`;

/** The same actions counted from the actions table alone, with no partner or tag joins. */
export const COUNT_SQL = (set: string) => `SELECT COUNT(*) AS n FROM actions a
 WHERE a.action_type IN (${(TYPES[set] || TYPES.both).map((x) => `'${x}'`).join(', ')}) AND substr(a.action_completed_date, 1, 10) BETWEEN ?1 AND ?2
   AND a.constituent_record_id IN (SELECT id FROM constituents)`;

const FR_SQL = 'SELECT id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers';

/** A fundraiser added since the last sync is not in the fundraisers table yet; the same id is a constituent record with the name. */
const NAMES_SQL = `SELECT id, first_name AS first, last_name AS last FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`;

const yes = (v: unknown, label: string) => (Number(v) === 1 ? label : '');
const parseIds = (v: unknown): string[] => {
  try {
    const x = JSON.parse(String(v ?? '[]'));
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
};

const leftOut = (edits: Record<string, string>): Set<string> =>
  new Set(Object.keys(edits).filter((k) => k.endsWith('|leave_out') && edits[k] === '1').map((k) => k.slice(0, -'|leave_out'.length)));

interface Extra {
  from: string;
  to: string;
  independent: number;
  shown: number;
  left: number;
}

const def: ReportDef = {
  id: 'rdd-actions',
  filters: [
    {
      id: 'when',
      label: 'Completed',
      type: 'seg',
      options: [
        ['month', 'This month'],
        ['last-month', 'Last month'],
        ['30', 'Last 30 days'],
        ['custom', 'Pick dates'],
      ],
      def: 'month',
    },
    { id: 'from', label: 'From', type: 'date', def: '', showWhen: { id: 'when', is: 'custom' } },
    { id: 'to', label: 'To', type: 'date', def: '', showWhen: { id: 'when', is: 'custom' } },
    {
      id: 'types',
      label: 'Action type',
      type: 'select',
      options: [
        ['both', 'RDD and church engagement'],
        ['rdd', 'RDD actions'],
        ['ced', 'Church engagement actions'],
      ],
      def: 'both',
    },
    { id: 'who', label: 'Fundraiser', type: 'text', def: '' },
  ],
  columns: [
    { key: 'id', label: 'Action ID', type: 'id' },
    { key: 'fundraisers', label: 'Fundraisers', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'adate', label: 'Action date', type: 'date' },
    { key: 'done', label: 'Completed on', type: 'date' },
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'ask', label: 'Amount of ask', type: 'money', total: true },
    { key: 'referrals', label: 'Referrals', type: 'int', total: true },
    { key: 'texted', label: 'Texted', type: 'chip' },
    { key: 'thanked', label: 'Thanked', type: 'chip' },
    { key: 'scheduling', label: 'Scheduling', type: 'chip' },
    { key: 'attended', label: 'Attended event', type: 'chip' },
    { key: 'hosted', label: 'Hosted event', type: 'chip' },
    { key: 'presented', label: 'Favor presentation', type: 'chip' },
    { key: 'stewardship', label: 'Stewardship', type: 'chip' },
  ],
  pageSize: 200,
  note: 'The same actions as the RDD Action Reporting query: completed actions of type RDD Action or CED Action in the dates you pick, with the tags typed on each action. Records on the leave-out list are not shown, as in the query. The KPI dashboard RDD tab counts these actions.',
  editable: { keyOf: (row) => String(row.id), columns: [] },

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const [from, to] = rangeFor(ctx.today, f);
    const [raw, frs, ind] = await Promise.all([
      ctx.sql<Row>(ROWS_SQL(f.types), [from, to]),
      ctx.sql<{ id: string; first: string; last: string }>(FR_SQL),
      ctx.sql<{ n: number }>(COUNT_SQL(f.types), [from, to]),
    ]);
    const names = new Map(frs.map((x) => [String(x.id), [x.last, x.first].filter(Boolean).join(', ')]));
    const missing = new Set<string>();
    for (const r of raw) for (const id of parseIds(r.frs)) if (!names.has(id)) missing.add(id);
    if (missing.size) {
      for (const x of await ctx.sql<{ id: string; first: string; last: string }>(NAMES_SQL, [JSON.stringify(Array.from(missing))])) {
        names.set(String(x.id), [x.last, x.first].filter(Boolean).join(', '));
      }
    }
    const out = leftOut(ctx.edits);
    const who = f.who.trim().toLowerCase();
    let left = 0;
    const rows: Row[] = [];
    for (const r of raw) {
      if (out.has(String(r.lookup))) {
        left += 1;
        continue;
      }
      const fundraisers = parseIds(r.frs).map((id) => names.get(id) || id).join('; ');
      if (who && !fundraisers.toLowerCase().includes(who)) continue;
      rows.push({
        id: r.id,
        lookup: r.lookup,
        fundraisers,
        category: String(r.category || ''),
        adate: r.adate || '',
        done: r.done || '',
        partner: String(r.partner || '').trim(),
        ask: r.ask === null || r.ask === undefined ? null : Number(r.ask),
        referrals: r.referrals === null || r.referrals === undefined ? null : Number(r.referrals),
        texted: yes(r.texted, 'Texted'),
        thanked: yes(r.thanked, 'Thanked'),
        scheduling: yes(r.scheduling, 'Scheduling'),
        attended: r.ah === 'Attended' ? 'Attended' : '',
        hosted: r.ah === 'Hosted' ? 'Hosted' : '',
        presented: yes(r.presented, 'Presented'),
        stewardship: yes(r.stewardship, 'Stewardship'),
      });
    }
    const extra: Extra = { from, to, independent: Number(ind[0]?.n) || 0, shown: raw.length, left };
    return { rows, extra, asOf: ctx.today };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as Extra;
    return compare(
      `Actions table, completed ${e.from} to ${e.to}, same types (separate count)`,
      e.shown,
      e.independent,
      'count',
      `${e.shown} actions before the leave-out list, ${e.left} left out. No KPI figure exists for this list.`
    );
  },

  tiles(rows): Tile[] {
    const by = new Set(rows.map((r) => String(r.fundraisers)));
    return [
      { label: 'Actions', value: rows.length, kind: 'int' },
      { label: 'Fundraiser groups', value: by.size, kind: 'int' },
      { label: 'Thanked', value: rows.filter((r) => r.thanked).length, kind: 'int' },
      { label: 'Amount of ask', value: Math.round(rows.reduce((s, r) => s + (Number(r.ask) || 0), 0)), kind: 'money' },
    ];
  },

  fileTag: (f) => f.when || 'month',
};

export default def;
