// Six-week email list for $5,000 partners. Replaces Carole's email list (saved query 1194). Read only.
// Ellie Brady pulls it on Friday afternoons. The nine typed-in partner ids sit in rpt_edits as "<id>|include" = "1",
// so the repository holds no partner ids.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';

const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";

const NAME = 'CASE WHEN k.constituent_type = \'Organization\' THEN COALESCE(k.organization_name, \'\') ELSE trim(COALESCE(k.first_name, \'\') || \' \' || COALESCE(k.last_name, \'\')) END';

const WIN = `WITH win AS (
  SELECT g.constituent_record_id AS cid, g.gift_amount AS amt, substr(g.gift_date, 1, 10) AS gdate
    FROM gifts g
   WHERE substr(g.gift_date, 1, 10) >= ?1 AND substr(g.gift_date, 1, 10) <= ?2 AND g.gift_amount > 0
     AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
), agg AS (
  SELECT cid, MAX(amt) AS largest, COUNT(*) AS n, SUM(amt) AS total, MAX(gdate) AS last_date FROM win GROUP BY cid
), cand AS (
  SELECT cid FROM agg WHERE largest >= 5000
  UNION
  SELECT value AS cid FROM json_each(?3)
)`;

const ROWS_SQL = `${WIN}
SELECT k.id AS id, ${NAME} AS name,
       (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = k.id AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> ''
         ORDER BY COALESCE(e.do_not_email, 0) ASC, e.is_primary DESC LIMIT 1) AS email,
       (SELECT COALESCE(e.do_not_email, 0) FROM emails e WHERE e.constituent_record_id = k.id AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> ''
         ORDER BY COALESCE(e.do_not_email, 0) ASC, e.is_primary DESC LIMIT 1) AS dne,
       (SELECT p.phone_number FROM phones p WHERE p.constituent_record_id = k.id AND COALESCE(p.is_inactive, 0) = 0 ORDER BY p.is_primary DESC LIMIT 1) AS phone,
       (SELECT COALESCE(p.do_not_call, 0) FROM phones p WHERE p.constituent_record_id = k.id AND COALESCE(p.is_inactive, 0) = 0 ORDER BY p.is_primary DESC LIMIT 1) AS dnc,
       COALESCE(a.n, 0) AS gifts, COALESCE(a.total, 0) AS total, a.last_date AS last_date,
       (SELECT w.amt FROM win w WHERE w.cid = k.id ORDER BY w.gdate DESC, w.amt DESC LIMIT 1) AS last_amt,
       COALESCE(a.largest, 0) AS largest,
       CASE WHEN COALESCE(k.inactive, 0) = 0 AND COALESCE(k.deceased, 0) = 0
             AND EXISTS (SELECT 1 FROM addresses ad WHERE ad.constituent_record_id = k.id AND COALESCE(ad.is_inactive, 0) = 0 AND COALESCE(ad.address_lines, '') <> '')
             AND EXISTS (SELECT 1 FROM emails e WHERE e.constituent_record_id = k.id AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> '')
            THEN 1 ELSE 0 END AS ok
  FROM cand c
  JOIN constituents k ON k.id = c.cid
  LEFT JOIN agg a ON a.cid = k.id
 ORDER BY name, k.id`;

const COUNT_SQL = `${WIN}
SELECT COUNT(*) AS n FROM constituents k WHERE k.id IN (SELECT cid FROM cand)`;

/** The date a window of whole months back from today starts on. */
function monthsBack(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - months, d));
  return dt.toISOString().slice(0, 10);
}

/** The partner ids typed in for this list, read from the stored edits. */
function typedIds(edits: Record<string, string>): string[] {
  return Object.keys(edits)
    .filter((k) => k.endsWith('|include') && edits[k] === '1')
    .map((k) => k.slice(0, -'|include'.length))
    .filter((id) => /^\d+$/.test(id));
}

const def: ReportDef = {
  id: 'carole-list',
  filters: [
    {
      id: 'within',
      label: 'Gifts within',
      type: 'select',
      options: [
        ['12', '12 months'],
        ['24', '24 months'],
        ['60', '5 years'],
        ['0', 'All time'],
      ],
      def: '24',
    },
  ],
  columns: [
    { key: 'name', label: 'Partner', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'gifts', label: 'Gifts', type: 'int' },
    { key: 'total', label: 'Given', type: 'money', total: true },
    { key: 'last_date', label: 'Last gift date', type: 'date' },
    { key: 'last_amt', label: 'Last gift', type: 'money' },
    { key: 'largest', label: 'Largest gift', type: 'money' },
    { key: 'dnc', label: 'Do not call', type: 'chip' },
  ],
  note: 'A partner is on the list with a gift of $5,000 or more in the window (largest gift), or one of the typed-in partners. Partners with an inactive or deceased record, no address, or no email are left off. Partners whose email is marked do not email are left off.',
  editable: { keyOf: (row) => String(row.id), columns: [] },

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const months = f.within === '0' ? 0 : Number(f.within) || 24;
    const from = months ? monthsBack(ctx.today, months) : '1900-01-01';
    const ids = typedIds(ctx.edits);
    const params = [from, ctx.today, JSON.stringify(ids)];
    const all = await ctx.sql<Row>(ROWS_SQL, params);
    const counted = (await ctx.sql<{ n: number }>(COUNT_SQL, params))[0];

    const rows = all
      .filter((r) => Number(r.ok) === 1 && Number(r.dne) !== 1)
      .map((r) => ({
        id: r.id,
        name: String(r.name || '').trim(),
        email: r.email,
        phone: r.phone || '',
        gifts: Number(r.gifts) || 0,
        total: Math.round(Number(r.total) * 100) / 100,
        last_date: r.last_date ? String(r.last_date).slice(0, 10) : '',
        last_amt: r.last_amt === null || r.last_amt === undefined ? null : Number(r.last_amt),
        largest: Number(r.largest) || 0,
        dnc: Number(r.dnc) === 1 ? 'Yes' : '',
      }) as Row);

    const leftOff = all.filter((r) => Number(r.ok) === 1 && Number(r.dne) === 1).length;
    return { rows, extra: { candidates: all.length, counted: Number(counted?.n) || 0, leftOff, from } };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as { candidates: number; counted: number };
    return compare(
      'Gifts table, same window and rule (separate query), partners before the email and address checks',
      e.candidates,
      e.counted,
      'count',
      'No KPI figure exists for this list.'
    );
  },

  tiles(rows, _f, extra): Tile[] {
    const e = extra as { leftOff: number };
    const sum = rows.reduce((s, r) => s + Number(r.total), 0);
    return [
      { label: 'Partners', value: rows.length, kind: 'int', sub: 'With an email on file' },
      { label: 'Given in the window', value: Math.round(sum), kind: 'money' },
      { label: 'Do not email', value: e.leftOff, kind: 'int', sub: 'Left off the list' },
    ];
  },
};

export default def;
