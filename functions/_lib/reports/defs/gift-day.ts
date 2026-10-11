// Gifts by day, with who holds the partner and the partner's last action. Replaces the Partner Care list of yesterday's
// gifts: the saved queries "Constituents for Actions - ALL" (1008) and one per director (375, 377, 927, 928, 1064, 1065,
// 1203, 376), and "Partner Care Constituent Gifts" (811). One report with filters instead of one query per director.
//
// The rows follow the saved query: the partner is the soft credit recipient when a gift has one and the giver when it has
// none ("Recipients"), each row is one gift on one partner for one open assignment, and a partner nobody holds shows with
// no holder. Read only, from the mirror.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';

/** The gift types the saved query asks for. Blackbaud's names on the left, the mirror's on the right. */
const TYPE_SETS: Record<string, string[]> = {
  query: ['Donation', 'RecurringGift', 'RecurringGiftPayment'],
  oneoff: ['Donation'],
  recurring: ['RecurringGift', 'RecurringGiftPayment'],
  every: [],
};
const TYPE_LABEL: Record<string, string> = {
  Donation: 'One-time gift',
  RecurringGift: 'Recurring gift (new)',
  RecurringGiftPayment: 'Recurring gift payment',
  GiftInKind: 'Gift in kind',
  'Stock/Property': 'Stock or property',
  Other: 'Other',
};

const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The date range a preset asks for. On a Monday "since the last list" reaches back over the weekend. */
export function rangeFor(today: string, f: Record<string, string>): [string, string] {
  if (f.when === 'custom') {
    const from = f.from || addDays(today, -1);
    const to = f.to || from;
    return from <= to ? [from, to] : [to, from];
  }
  if (f.when === 'week') return [addDays(today, -7), addDays(today, -1)];
  const yesterday = addDays(today, -1);
  if (f.when === 'yesterday') return [yesterday, yesterday];
  // since: Monday looks back to Friday, Saturday and Sunday. Any other day is yesterday.
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  return dow === 1 ? [addDays(today, -3), yesterday] : [yesterday, yesterday];
}

const typeSql = (set: string): string => {
  const t = TYPE_SETS[set] ?? TYPE_SETS.query;
  return t.length ? `AND gift_type IN (${t.map((x) => `'${x}'`).join(', ')})` : '';
};

const NAME = (a: string) => `CASE WHEN ${a}.constituent_type = 'Organization' THEN COALESCE(${a}.organization_name, '')
  ELSE trim(COALESCE(${a}.first_name, '') || CASE WHEN COALESCE(${a}.middle_name, '') <> '' THEN ' ' || substr(${a}.middle_name, 1, 1) || '.' ELSE '' END || ' ' || COALESCE(${a}.last_name, '')) END`;

/** Parameters: ?1 first day, ?2 last day, ?3 smallest gift. */
export const ROWS_SQL = (set: string, both = false) => `WITH g AS (
  SELECT id, substr(gift_date, 1, 10) AS d, gift_amount AS amt, gift_type AS gtype, constituent_record_id AS cid,
         CASE WHEN soft_credits IS NOT NULL AND json_valid(soft_credits) THEN soft_credits ELSE '[]' END AS sc,
         CASE WHEN gift_splits IS NOT NULL AND json_valid(gift_splits) THEN gift_splits ELSE '[]' END AS gs
    FROM gifts
   WHERE substr(gift_date, 1, 10) BETWEEN ?1 AND ?2 AND gift_amount >= ?3 ${typeSql(set)}
), ap AS (
  SELECT gid, group_concat(appeal_id, ', ') AS appeal FROM (
    SELECT DISTINCT g.id AS gid, s.appeal_id AS appeal_id FROM g, json_each(g.gs) AS sp
      JOIN appeals s ON s.id = CAST(json_extract(sp.value, '$.appeal_id') AS TEXT)
     ORDER BY g.id, s.appeal_id)
   GROUP BY gid
), cr AS (
  SELECT g.id AS gid, g.d AS d, g.amt AS amt, g.gtype AS gtype, g.cid AS giver, CAST(json_extract(j.value, '$.constituent_id') AS TEXT) AS rid
    FROM g, json_each(g.sc) AS j WHERE json_extract(j.value, '$.constituent_id') IS NOT NULL
  UNION ALL
  SELECT g.id, g.d, g.amt, g.gtype, g.cid, g.cid FROM g
   WHERE g.cid IS NOT NULL ${both ? '' : "AND NOT EXISTS (SELECT 1 FROM json_each(g.sc) AS j2 WHERE json_extract(j2.value, '$.constituent_id') IS NOT NULL)"}
), la AS (
  SELECT constituent_record_id AS cid, substr(action_date_due, 1, 10) AS d, action_type AS t, json_extract(raw_json, '$.completed') AS done,
         ROW_NUMBER() OVER (PARTITION BY constituent_record_id ORDER BY action_date_due DESC, CAST(id AS INTEGER) DESC) AS rn
    FROM actions WHERE constituent_record_id IN (SELECT rid FROM cr)
)
SELECT cr.gid AS gid, cr.d AS gdate, cr.amt AS amount, cr.gtype AS gtype, cr.rid AS rid, k.constituent_lookup_id AS lookup, ${NAME('k')} AS partner,
       CASE WHEN cr.giver <> cr.rid THEN ${NAME('gv')} ELSE '' END AS giver,
       trim(COALESCE(f.fundraiser_first_name, fc.first_name, '') || ' ' || COALESCE(f.fundraiser_last_name, fc.last_name, '')) AS holder, x.assignment_type AS holder_type,
       ap.appeal AS appeal,
       la.d AS last_date, la.t AS last_type, la.done AS last_done,
       (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = cr.rid AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> ''
         ORDER BY e.is_primary DESC, COALESCE(e.do_not_email, 0) ASC LIMIT 1) AS email,
       (SELECT p.phone_number FROM phones p WHERE p.constituent_record_id = cr.rid AND COALESCE(p.is_inactive, 0) = 0 AND COALESCE(p.phone_number, '') <> ''
         ORDER BY p.is_primary DESC LIMIT 1) AS phone,
       COALESCE(k.deceased, 0) AS deceased, COALESCE(k.inactive, 0) AS inactive
  FROM cr
  JOIN constituents k ON k.id = cr.rid
  LEFT JOIN constituents gv ON gv.id = cr.giver
  LEFT JOIN assignments x ON x.constituent_record_id = cr.rid AND x.assignment_to_date IS NULL
  LEFT JOIN fundraisers f ON f.id = x.assignment_fundraiser_id
  LEFT JOIN constituents fc ON fc.id = x.assignment_fundraiser_id AND f.id IS NULL
  LEFT JOIN ap ON ap.gid = cr.gid
  LEFT JOIN la ON la.cid = cr.rid AND la.rn = 1
 ORDER BY holder, cr.d, partner, cr.gid`;

/** The same gifts counted straight from the gifts table: one row per gift, no partner or holder joins. */
export const COUNT_SQL = (set: string) => `SELECT COUNT(*) AS n, COALESCE(SUM(gift_amount), 0) AS total FROM gifts
 WHERE substr(gift_date, 1, 10) BETWEEN ?1 AND ?2 AND gift_amount >= ?3 ${typeSql(set)} AND constituent_record_id IS NOT NULL`;

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Extra {
  from: string;
  to: string;
  independent: { n: number; total: number };
  distinct: { n: number; total: number };
  narrowed: boolean;
}

const def: ReportDef = {
  id: 'gift-day',
  filters: [
    {
      id: 'when',
      label: 'Gifts from',
      type: 'seg',
      options: [
        ['since', 'Since the last list'],
        ['yesterday', 'Yesterday'],
        ['week', 'Last 7 days'],
        ['custom', 'Pick dates'],
      ],
      def: 'since',
    },
    { id: 'from', label: 'From', type: 'date', def: '', showWhen: { id: 'when', is: 'custom' } },
    { id: 'to', label: 'To', type: 'date', def: '', showWhen: { id: 'when', is: 'custom' } },
    {
      id: 'min',
      label: 'Amount',
      type: 'select',
      options: [
        ['5', '$5 and up'],
        ['0.01', 'Any amount'],
        ['50', '$50 and up'],
        ['1000', '$1,000 and up'],
        ['5000', '$5,000 and up'],
      ],
      def: '5',
    },
    {
      id: 'types',
      label: 'Gift type',
      type: 'select',
      options: [
        ['query', 'Gifts and recurring gifts'],
        ['oneoff', 'One-time gifts only'],
        ['recurring', 'Recurring gifts only'],
        ['every', 'Every type'],
      ],
      def: 'query',
    },
    {
      id: 'credit',
      label: 'Soft credits',
      type: 'select',
      options: [
        ['recipient', 'Partner who received the credit'],
        ['both', 'Giver and partner who received the credit'],
      ],
      def: 'recipient',
    },
    {
      id: 'holder',
      label: 'Held by',
      type: 'select',
      options: [
        ['', 'Anyone'],
        ['none', 'No one'],
        ['Partner Care', 'Partner Care'],
        ['director', 'A director'],
      ],
      def: '',
    },
    { id: 'who', label: 'Holder name', type: 'text', def: '' },
  ],
  columns: [
    { key: 'gdate', label: 'Gift date', type: 'date' },
    { key: 'lookup', label: 'Constituent ID', type: 'id' },
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'money' },
    { key: 'giver', label: 'Soft credited from', type: 'text' },
    { key: 'holder', label: 'Assigned fundraiser', type: 'text' },
    { key: 'gtype', label: 'Gift type', type: 'text' },
    { key: 'appeal', label: 'Appeal IDs', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'last_date', label: 'Last action', type: 'date' },
    { key: 'last_type', label: 'Last action type', type: 'text' },
    { key: 'last_done', label: 'Completed', type: 'chip' },
  ],
  note: 'The same gifts as Partner Care\'s Constituents for Actions queries. A soft credited gift shows on the partner who received the credit. A row is one gift for one assigned fundraiser, so a partner with two holders has two rows. A gift split across appeals shows once, with each appeal listed; Blackbaud repeats it once per split. Last action is the partner\'s most recent action by date. The total counts each gift once per partner.',

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const [from, to] = rangeFor(ctx.today, f);
    const min = Number(f.min) > 0 ? Number(f.min) : 0.01;
    const raw = await ctx.sql<Row>(ROWS_SQL(f.types, f.credit === 'both'), [from, to, min]);
    const who = f.who.trim().toLowerCase();
    const narrowed = Boolean(f.holder || who);
    const kept = raw.filter((r) => {
      const h = String(r.holder || '');
      if (f.holder === 'none' && h) return false;
      if (f.holder === 'Partner Care' && String(r.holder_type || '') !== 'Partner Care') return false;
      if (f.holder === 'director' && !/Director|Steward|RDD/i.test(String(r.holder_type || ''))) return false;
      if (who && !h.toLowerCase().includes(who)) return false;
      return true;
    });
    // Two open assignments to the same fundraiser on one partner would show the gift twice.
    const once = new Set<string>();
    const unique = kept.filter((r) => {
      const k = `${r.gid}|${r.rid}|${r.holder}`;
      if (once.has(k)) return false;
      once.add(k);
      return true;
    });
    const rows = unique.map(
      (r) =>
        ({
          gid: r.gid,
          gdate: String(r.gdate),
          lookup: r.lookup,
          partner: String(r.partner || '').trim(),
          amount: Number(r.amount),
          giver: String(r.giver || '').trim(),
          holder: String(r.holder || '').trim(),
          gtype: TYPE_LABEL[String(r.gtype)] || String(r.gtype),
          appeal: r.appeal || '',
          email: r.email || '',
          phone: r.phone || '',
          last_date: r.last_date ? String(r.last_date) : '',
          last_type: r.last_type || '',
          last_done: r.last_date ? (Number(r.last_done) === 1 ? 'Yes' : 'No') : '',
          rid: r.rid,
        }) as Row
    );
    let dt = 0;
    const gifts = new Map<string, number>();
    for (const r of raw) gifts.set(String(r.gid), Number(r.amount));
    const dn = gifts.size;
    for (const a of gifts.values()) dt += a;
    const ind = (await ctx.sql<{ n: number; total: number }>(COUNT_SQL(f.types), [from, to, min]))[0] || { n: 0, total: 0 };
    const extra: Extra = { from, to, independent: { n: Number(ind.n), total: Number(ind.total) }, distinct: { n: dn, total: r2(dt) }, narrowed };
    return { rows, extra, asOf: ctx.today };
  },

  totals(rows) {
    const seen = new Set<string>();
    let s = 0;
    for (const r of rows) {
      const k = `${r.gid}|${r.rid}`;
      if (seen.has(k)) continue;
      seen.add(k);
      s += Number(r.amount);
    }
    return { amount: r2(s) };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as Extra;
    return compare(
      `Gifts table, ${e.from === e.to ? e.from : `${e.from} to ${e.to}`}, same amount and type (separate query, one row per gift)`,
      e.distinct.n,
      e.independent.n,
      'count',
      `Gifts on the list ${e.distinct.n} for ${money(e.distinct.total)}; gifts table ${e.independent.n} for ${money(e.independent.total)}. No KPI figure exists for this list.`
    );
  },

  tiles(rows): Tile[] {
    const partners = new Set(rows.map((r) => String(r.rid)));
    const gifts = new Map<string, number>();
    for (const r of rows) gifts.set(String(r.gid), Number(r.amount));
    const sum = Array.from(gifts.values()).reduce((a, b) => a + b, 0);
    const open = rows.filter((r) => r.last_done === 'No').length;
    return [
      { label: 'Gifts', value: gifts.size, kind: 'int', sub: money(sum) },
      { label: 'Partners', value: partners.size, kind: 'int' },
      { label: 'Held by no one', value: rows.filter((r) => !r.holder).length, kind: 'int' },
      { label: 'Last action open', value: open, kind: 'int' },
    ];
  },

  fileTag: (f) => f.when || 'since',
};

export default def;
