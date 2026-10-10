// Gifts of $5,000 and up: the HQTY letter list. Replaces the 5k TY query and the $5,000 and Up lists (741, 1054, 1198).
// Read only. The partner is the soft-credited recipient when a gift has one, and the giver when nobody is.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';

const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";
const LETTER = 'RESERVED (HQTY Letter)';

const NAME = (a: string) =>
  `CASE WHEN ${a}.constituent_type = 'Organization' THEN COALESCE(${a}.organization_name, '') ELSE trim(COALESCE(${a}.first_name, '') || ' ' || COALESCE(${a}.last_name, '')) END`;

const BASE = `WITH base AS (
  SELECT g.id AS gift_id, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.constituent_record_id AS giver_id,
         COALESCE(g.gift_constituency, '') AS constituency, COALESCE(f.fund_description, g.fund_id, '') AS fund,
         json_extract(g.soft_credits, '$[0].constituent_id') AS soft_id
    FROM gifts g LEFT JOIN funds f ON f.id = g.fund_id
   WHERE g.gift_amount >= ?1 AND substr(g.gift_date, 1, 10) BETWEEN ?2 AND ?3
     AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
)`;

const ROWS_SQL = `${BASE}
SELECT b.gift_id AS gift_id, b.gdate AS gdate, b.amount AS amount, b.fund AS fund, b.constituency AS constituency,
       COALESCE(b.soft_id, b.giver_id) AS partner_id, b.giver_id AS giver_id,
       ${NAME('pk')} AS partner, ${NAME('gk')} AS giver,
       (SELECT ad.address_lines FROM addresses ad WHERE ad.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND COALESCE(ad.is_inactive, 0) = 0 ORDER BY ad.is_primary DESC LIMIT 1) AS line,
       (SELECT ad.address_city FROM addresses ad WHERE ad.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND COALESCE(ad.is_inactive, 0) = 0 ORDER BY ad.is_primary DESC LIMIT 1) AS city,
       (SELECT ad.address_state FROM addresses ad WHERE ad.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND COALESCE(ad.is_inactive, 0) = 0 ORDER BY ad.is_primary DESC LIMIT 1) AS state,
       (SELECT ad.address_postal_code FROM addresses ad WHERE ad.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND COALESCE(ad.is_inactive, 0) = 0 ORDER BY ad.is_primary DESC LIMIT 1) AS zip,
       (SELECT COUNT(*) FROM actions t WHERE t.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND t.action_type = '${LETTER}'
          AND substr(COALESCE(t.action_completed_date, t.action_date_due), 1, 10) >= b.gdate) AS letters
  FROM base b
  LEFT JOIN constituents pk ON pk.id = COALESCE(b.soft_id, b.giver_id)
  LEFT JOIN constituents gk ON gk.id = b.giver_id
 ORDER BY b.gdate, b.amount DESC, b.gift_id`;

const TOTALS_SQL = `SELECT COUNT(*) AS n, COALESCE(SUM(g.gift_amount), 0) AS total FROM gifts g
 WHERE g.gift_amount >= ?1 AND substr(g.gift_date, 1, 10) BETWEEN ?2 AND ?3
   AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'`;

/** The date range a preset asks for, from today's Eastern date. */
function dateRange(today: string, preset: string): [string, string] {
  const addDays = (day: string, n: number) => {
    const d = new Date(day + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  if (preset === 'month') {
    const end = addDays(today.slice(0, 8) + '01', -1);
    return [end.slice(0, 8) + '01', end];
  }
  if (preset === 'year') return [today.slice(0, 4) + '-01-01', today];
  return [addDays(today, -365), today];
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function through(constituency: string): string {
  if (constituency === 'DAF Provider') return 'DAF';
  if (constituency === 'Foundation') return 'Foundation';
  return 'Direct';
}

interface Extra {
  /** Every gift the rules pick, before the letter and preset filters. */
  mine: { n: number; total: number };
  /** The same gifts counted straight from the gifts table. */
  independent: { n: number; total: number };
}

const def: ReportDef = {
  id: 'large-gifts',
  filters: [
    {
      id: 'preset',
      label: 'List',
      type: 'seg',
      options: [
        ['new', 'Not yet mailed, last 12 months'],
        ['month', 'Last month'],
        ['year', 'This year'],
      ],
      def: 'new',
    },
    {
      id: 'min',
      label: 'Amount',
      type: 'select',
      options: [
        ['5000', '$5,000 and up'],
        ['10000', '$10,000 and up'],
      ],
      def: '5000',
    },
    {
      id: 'letter',
      label: 'Letter',
      type: 'select',
      options: [
        ['', 'Any status'],
        ['Not mailed', 'Not mailed'],
        ['Mailed', 'Mailed'],
        ['Hold', 'Hold'],
      ],
      def: '',
    },
  ],
  columns: [
    { key: 'gdate', label: 'Gift date', type: 'date' },
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'money', total: true },
    { key: 'fund', label: 'Fund', type: 'text' },
    { key: 'through', label: 'Gave through', type: 'text' },
    { key: 'giver', label: 'Giver', type: 'text' },
    { key: 'address', label: 'Preferred address', type: 'text' },
    { key: 'letter', label: 'Letter', type: 'chip' },
  ],
  note: 'Letter status comes from HQTY Letter actions on the partner record, dated on or after the gift. Hold means the partner has no address on record.',

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const min = Number(f.min) || 5000;
    const [from, to] = dateRange(ctx.today, f.preset);
    const raw = await ctx.sql<Row>(ROWS_SQL, [min, from, to]);
    const totalsRow = (await ctx.sql<{ n: number; total: number }>(TOTALS_SQL, [min, from, to]))[0] || { n: 0, total: 0 };

    const all = raw.map((r) => {
      const line = String(r.line || '').trim();
      const letter = !line ? 'Hold' : Number(r.letters) > 0 ? 'Mailed' : 'Not mailed';
      const cityLine = [r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const addr = line ? [line, cityLine].filter(Boolean).join(', ') : '';
      return {
        gift_id: r.gift_id,
        gdate: r.gdate,
        amount: Number(r.amount),
        partner: String(r.partner || '').trim(),
        fund: r.fund,
        through: through(String(r.constituency || '')),
        giver: String(r.giver || '').trim(),
        address: addr,
        letter,
      } as Row;
    });

    const rows = all.filter((r) => {
      if (f.preset === 'new' && r.letter === 'Mailed') return false;
      if (f.letter && r.letter !== f.letter) return false;
      return true;
    });

    const extra: Extra = {
      mine: { n: all.length, total: Math.round(all.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100 },
      independent: { n: Number(totalsRow.n), total: Number(totalsRow.total) },
    };
    return { rows, extra };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as Extra;
    return compare(
      'Gifts table, same dates and minimum (separate query)',
      e.mine.total,
      e.independent.total,
      'money',
      `Gifts: this report ${e.mine.n}, gifts table ${e.independent.n}. No KPI figure exists for this list.`
    );
  },

  tiles(rows): Tile[] {
    const nm = rows.filter((r) => r.letter === 'Not mailed');
    const sum = (xs: Row[]) => xs.reduce((s, r) => s + Number(r.amount), 0);
    return [
      { label: 'Gifts', value: rows.length, kind: 'int', sub: money(sum(rows)) },
      { label: 'Letters to mail', value: nm.length, kind: 'int', sub: money(sum(nm)) },
      { label: 'On hold', value: rows.filter((r) => r.letter === 'Hold').length, kind: 'int', sub: 'No address on record' },
      { label: 'Through a DAF or foundation', value: rows.filter((r) => r.through !== 'Direct').length, kind: 'int' },
    ];
  },
};

export default def;
