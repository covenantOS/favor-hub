// Thank-you packets, quarterly: gifts of $5,000 and up in one quarter, with the packet each partner gets and the email
// check. Replaces the quarterly packet list that Megan Respass uses (the Designations sheet, Q3 2026 as the model). Read only.
// The packet is an email. A postal-mail note is not a reason to leave someone off. Only an email restriction is.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';

const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";

const QUARTERS: Record<string, [string, string]> = {
  '2026-Q1': ['2026-01-01', '2026-03-31'],
  '2026-Q2': ['2026-04-01', '2026-06-30'],
  '2026-Q3': ['2026-07-01', '2026-09-30'],
  '2026-Q4': ['2026-10-01', '2026-12-31'],
};

const NAME = (a: string) =>
  `CASE WHEN ${a}.constituent_type = 'Organization' THEN COALESCE(${a}.organization_name, '') ELSE trim(COALESCE(${a}.first_name, '') || ' ' || COALESCE(${a}.last_name, '')) END`;

const BASE = `WITH base AS (
  SELECT g.id AS gift_id, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.constituent_record_id AS giver_id,
         COALESCE(g.gift_constituency, '') AS constituency, COALESCE(f.fund_description, '') AS fund,
         json_extract(g.soft_credits, '$[0].constituent_id') AS soft_id
    FROM gifts g LEFT JOIN funds f ON f.id = json_extract(g.gift_splits, '$[0].fund_id')
   WHERE g.gift_amount >= 5000 AND substr(g.gift_date, 1, 10) BETWEEN ?1 AND ?2
     AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
)`;

const ROWS_SQL = `${BASE}
SELECT b.gift_id AS gift_id, b.gdate AS gdate, b.amount AS amount, b.fund AS fund, b.constituency AS constituency,
       COALESCE(b.soft_id, b.giver_id) AS partner_id,
       ${NAME('pk')} AS partner,
       (SELECT ad.address_state FROM addresses ad WHERE ad.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND COALESCE(ad.is_inactive, 0) = 0 ORDER BY ad.is_primary DESC LIMIT 1) AS state,
       (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> ''
         ORDER BY COALESCE(e.do_not_email, 0) ASC, e.is_primary DESC LIMIT 1) AS email,
       (SELECT COALESCE(e.do_not_email, 0) FROM emails e WHERE e.constituent_record_id = COALESCE(b.soft_id, b.giver_id) AND COALESCE(e.is_inactive, 0) = 0 AND COALESCE(e.email_address, '') <> ''
         ORDER BY COALESCE(e.do_not_email, 0) ASC, e.is_primary DESC LIMIT 1) AS dne,
       CASE WHEN (COALESCE(pk.inactive, 0) = 1 OR COALESCE(pk.deceased, 0) = 1)
             AND NOT EXISTS (SELECT 1 FROM constituents s WHERE (s.id = pk.spouse_id OR s.spouse_id = pk.id) AND COALESCE(s.inactive, 0) = 0 AND COALESCE(s.deceased, 0) = 0)
            THEN 1 ELSE 0 END AS hh_out
  FROM base b
  LEFT JOIN constituents pk ON pk.id = COALESCE(b.soft_id, b.giver_id)
 ORDER BY b.gdate, b.amount DESC, b.gift_id`;

const TOTALS_SQL = `SELECT COUNT(*) AS n, COALESCE(SUM(g.gift_amount), 0) AS total FROM gifts g
 WHERE g.gift_amount >= 5000 AND substr(g.gift_date, 1, 10) BETWEEN ?1 AND ?2
   AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'`;

/** The packet tag a designation goes in. Inferred from the designation names: Chad, GIFT and education, and everything else in Ev & Disc. Megan has not confirmed the rule. */
function packetOf(fund: string): string {
  const f = fund.toLowerCase();
  if (f.includes('chad')) return 'Chad';
  if (f.includes('gift') || f.includes('education') || f.includes('school')) return 'GIFT & Education';
  return 'Ev & Disc';
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

interface Extra {
  mine: { n: number; total: number };
  independent: { n: number; total: number };
  dne: number;
  out: number;
}

const def: ReportDef = {
  id: 'packets',
  filters: [
    {
      id: 'q',
      label: 'Quarter',
      type: 'select',
      options: [
        ['2026-Q1', '2026 Q1'],
        ['2026-Q2', '2026 Q2'],
        ['2026-Q3', '2026 Q3'],
        ['2026-Q4', '2026 Q4'],
      ],
      def: '2026-Q3',
    },
    {
      id: 'cat',
      label: 'Category',
      type: 'select',
      options: [
        ['', 'All'],
        ['Partner', 'Partner'],
        ['Foundation', 'Foundation'],
        ['DAF Provider', 'DAF'],
        ['Ministry', 'Ministry'],
      ],
      def: '',
    },
  ],
  columns: [
    { key: 'gdate', label: 'Gift date', type: 'date' },
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'money', total: true },
    { key: 'fund', label: 'Designation', type: 'text' },
    { key: 'packet', label: 'Packet', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'state', label: 'State', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'send', label: 'Send', type: 'chip' },
  ],
  note: 'The partner is the soft-credited recipient when a gift has one, and the giver when nobody is. The email is the partner record\'s primary active email. Partners marked do not email, and households whose every record is deceased or inactive, are left off the list and counted in Left off. Check the unsubscribe ledger and GoHighLevel before the import, because this report does not read them.',

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const [from, to] = QUARTERS[f.q] || QUARTERS['2026-Q3'];
    const raw = await ctx.sql<Row>(ROWS_SQL, [from, to]);
    const totalsRow = (await ctx.sql<{ n: number; total: number }>(TOTALS_SQL, [from, to]))[0] || { n: 0, total: 0 };

    const all = raw.map((r) => {
      const fund = String(r.fund || '');
      const send = Number(r.hh_out) === 1 ? 'Deceased or inactive' : !r.email ? 'No email' : Number(r.dne) === 1 ? 'Do not email' : 'Email';
      return {
        gift_id: r.gift_id,
        gdate: r.gdate,
        amount: Number(r.amount),
        partner: String(r.partner || '').trim(),
        fund,
        packet: packetOf(fund),
        category: String(r.constituency || 'Partner'),
        state: r.state || '',
        email: r.email || '',
        send,
        constituency: String(r.constituency || ''),
      } as Row;
    });

    // Households with nobody living or active and partners marked do not email are left off the list, and counted in the tiles.
    const rows = all.filter((r) => (!f.cat || r.constituency === f.cat) && r.send !== 'Deceased or inactive' && r.send !== 'Do not email');
    const leftOff = all.filter((r) => (!f.cat || r.constituency === f.cat) && (r.send === 'Deceased or inactive' || r.send === 'Do not email'));
    const extra: Extra = {
      mine: { n: all.length, total: Math.round(all.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100 },
      independent: { n: Number(totalsRow.n), total: Number(totalsRow.total) },
      dne: leftOff.filter((r) => r.send === 'Do not email').length,
      out: leftOff.filter((r) => r.send === 'Deceased or inactive').length,
    };
    return { rows, extra };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as Extra;
    return compare(
      'Gifts table, same quarter and $5,000 minimum (separate query)',
      e.mine.total,
      e.independent.total,
      'money',
      `Gifts: this report ${e.mine.n}, gifts table ${e.independent.n}. No KPI figure exists for this list.`
    );
  },

  tiles(rows, _f, extra): Tile[] {
    const e = extra as Extra;
    const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
    const count = (send: string) => rows.filter((r) => r.send === send).length;
    return [
      { label: 'Gifts', value: rows.length, kind: 'int', sub: money(sum) },
      { label: 'Foundation and DAF', value: rows.filter((r) => r.constituency === 'Foundation' || r.constituency === 'DAF Provider').length, kind: 'int' },
      { label: 'Email', value: count('Email'), kind: 'int', sub: 'Gets the packet' },
      { label: 'No email', value: count('No email'), kind: 'int', sub: 'Gets no packet' },
      { label: 'Left off', value: e.dne + e.out, kind: 'int', sub: `${e.dne} do not email, ${e.out} deceased or inactive households` },
    ];
  },
};

export default def;
