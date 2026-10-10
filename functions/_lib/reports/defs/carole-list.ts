// Six-week email list for $5,000 partners. Replaces Carole's email list (saved query 1194). Read only.
// Ellie Brady pulls it on Friday afternoons. The nine typed-in partner ids sit in rpt_edits as "<id>|include" = "1",
// so the repository holds no partner ids.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';

const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";

const NAME = `CASE WHEN k.constituent_type = 'Organization' THEN COALESCE(k.organization_name, '') ELSE trim(COALESCE(k.first_name, '') || ' ' || COALESCE(k.last_name, '')) END`;

// Saved query 1194, as Blackbaud runs it: gift credit goes to the soft-credit recipients when a gift has any ("Recipients"),
// otherwise to the giver. A partner is on the list with any gift in the window, a largest gift of $5,000 or more at any
// date, and an active email. Nine typed-in partners (Constituent IDs, the lookup id) skip the $5,000 test but still need
// a gift in the window. Inactive, deceased and no-address records stay in 1194. The rules below drop them.
const WIN = `WITH cred AS (
  SELECT g.constituent_record_id AS cid, g.gift_amount AS amt, substr(g.gift_date, 1, 10) AS gdate
    FROM gifts g
   WHERE g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
     AND (g.gift_amount >= 5000 OR (substr(g.gift_date, 1, 10) >= ?1 AND substr(g.gift_date, 1, 10) <= ?2))
     AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(g.soft_credits, '[]')) s WHERE json_extract(s.value, '$.constituent_id') <> g.constituent_record_id)
  UNION ALL
  SELECT json_extract(s.value, '$.constituent_id') AS cid, g.gift_amount AS amt, substr(g.gift_date, 1, 10) AS gdate
    FROM gifts g, json_each(g.soft_credits) s
   WHERE g.soft_credits LIKE '%constituent_id%' AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
     AND (g.gift_amount >= 5000 OR (substr(g.gift_date, 1, 10) >= ?1 AND substr(g.gift_date, 1, 10) <= ?2))
     AND json_extract(s.value, '$.constituent_id') <> g.constituent_record_id
), win AS (
  SELECT cid, amt, gdate FROM cred WHERE gdate >= ?1 AND gdate <= ?2
), agg AS (
  SELECT cid, MAX(amt) AS largest_win, COUNT(*) AS n, SUM(amt) AS total, MAX(gdate) AS last_date FROM win GROUP BY cid
), big AS (
  SELECT cid, MAX(amt) AS largest FROM cred WHERE amt >= 5000 GROUP BY cid
), cand AS (
  SELECT a.cid AS cid FROM agg a
   WHERE a.cid IN (SELECT cid FROM big)
      OR a.cid IN (SELECT k2.id FROM constituents k2 WHERE k2.constituent_lookup_id IN (SELECT value FROM json_each(?3)))
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
       COALESCE((SELECT b.largest FROM big b WHERE b.cid = k.id), a.largest_win, 0) AS largest,
       CASE WHEN (COALESCE(k.inactive, 0) = 1 OR COALESCE(k.deceased, 0) = 1)
             AND NOT EXISTS (SELECT 1 FROM constituents s WHERE (s.id = k.spouse_id OR s.spouse_id = k.id) AND COALESCE(s.inactive, 0) = 0 AND COALESCE(s.deceased, 0) = 0)
            THEN 1 ELSE 0 END AS hh_out,
       CASE WHEN EXISTS (SELECT 1 FROM emails e WHERE e.constituent_record_id = k.id AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> '') THEN 1 ELSE 0 END AS has_email
  FROM cand c
  JOIN constituents k ON k.id = c.cid
  LEFT JOIN agg a ON a.cid = k.id
 ORDER BY name, k.id`;

// The independent count: partners with a gift in the window whose credited gifts reach $5,000 or who are typed in, and who have an active email.
const COUNT_SQL = `${WIN}
SELECT COUNT(*) AS n FROM constituents k
 WHERE k.id IN (SELECT cid FROM cand)
   AND EXISTS (SELECT 1 FROM emails e WHERE e.constituent_record_id = k.id AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> '')`;

/** The date a window of whole months back from today starts on. */
function monthsBack(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - months, d));
  return dt.toISOString().slice(0, 10);
}

/** Six weeks back from today. */
function weeksBack(today: string, weeks: number): string {
  const dt = new Date(today + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() - weeks * 7);
  return dt.toISOString().slice(0, 10);
}

/** The partner ids typed in for this list, read from the stored edits. */
function typedIds(edits: Record<string, string>): string[] {
  return Object.keys(edits)
    .filter((k) => k.endsWith('|include') && edits[k] === '1')
    .map((k) => k.slice(0, -'|include'.length))
    .filter((id) => /^[A-Za-z0-9-]{1,20}$/.test(id));
}

const def: ReportDef = {
  id: 'carole-list',
  filters: [
    {
      id: 'within',
      label: 'Gifts within',
      type: 'select',
      options: [
        ['6w', 'Six weeks'],
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
  note: 'Saved query 1194 as Blackbaud runs it. A partner is on the list with a gift in the window, a largest gift of $5,000 or more at any date (soft credits count for the recipient), and an active email, or is one of the typed-in partners with a gift in the window. Households whose every record is deceased or inactive are left off, and so are partners whose email is marked do not email. Query 1194 itself keeps both. Query 1194 counts one row for each gift in the window and email, so its saved record count (1,088 on August 28) is a row count and not a partner count. Checked on 2026-10-10 against runs of 1194: the same partners at six weeks, 12 months, 24 months and all time.',
  editable: { keyOf: (row) => String(row.id), columns: [] },

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const months = f.within === '0' || f.within === '6w' ? 0 : Number(f.within) || 24;
    const from = f.within === '6w' ? weeksBack(ctx.today, 6) : months ? monthsBack(ctx.today, months) : '1900-01-01';
    const ids = typedIds(ctx.edits);
    const params = [from, ctx.today, JSON.stringify(ids)];
    const all = await ctx.sql<Row>(ROWS_SQL, params);
    const counted = (await ctx.sql<{ n: number }>(COUNT_SQL, params))[0];

    const rows = all
      .filter((r) => Number(r.has_email) === 1 && Number(r.hh_out) !== 1 && Number(r.dne) !== 1)
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

    const withEmail = all.filter((r) => Number(r.has_email) === 1);
    const leftOff = withEmail.filter((r) => Number(r.hh_out) !== 1 && Number(r.dne) === 1).length;
    const deceased = withEmail.filter((r) => Number(r.hh_out) === 1).length;
    return { rows, extra: { candidates: withEmail.length, counted: Number(counted?.n) || 0, leftOff, deceased, from } };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as { candidates: number; counted: number };
    return compare(
      'Gifts table, same window and the query 1194 rule (separate query), partners with an email before the deceased, inactive and do-not-email rules',
      e.candidates,
      e.counted,
      'count',
      'No KPI figure exists for this list.'
    );
  },

  tiles(rows, _f, extra): Tile[] {
    const e = extra as { leftOff: number; deceased: number };
    const sum = rows.reduce((s, r) => s + Number(r.total), 0);
    return [
      { label: 'Partners', value: rows.length, kind: 'int', sub: 'With an email on file' },
      { label: 'Given in the window', value: Math.round(sum), kind: 'money' },
      { label: 'Do not email', value: e.leftOff, kind: 'int', sub: 'Left off the list' },
      { label: 'Deceased or inactive', value: e.deceased, kind: 'int', sub: 'Households left off the list' },
    ];
  },
};

export default def;
