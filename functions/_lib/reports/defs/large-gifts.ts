// Gifts of $5,000 and up: the HQTY letter list. Replaces the 5k TY query and the $5,000 and Up lists (741, 1054, 1198).
// Read only. It reads the gifts through the Work Center HQTY letters desk (loadHqty), so the two always pick the same gifts:
// the partner is the first soft-credited recipient when a gift has one, the giver when nobody is, a letter counts as written
// when a completed HQTY Letter action sits on the giver or the partner on or after the gift, and a household whose every
// record is deceased or inactive is left off while its letter is still to write.
import type { Loaded, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { compare } from '../tieout';
import { DESK_SINCE, loadHqty, type HqtyRow } from '../../work/hqty';

const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";

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

/** The Letter column. The desk's own states, with Hold for a letter that has no address to go to. */
function letterOf(r: HqtyRow): string {
  if (r.state === 'mailed') return 'Mailed';
  if (r.state === 'cannot') return 'Not mailing';
  if (r.state === 'printed') return 'Printed';
  if (r.state === 'signed') return 'Signed';
  return r.flags.includes('No mailing address') ? 'Hold' : 'Not mailed';
}

interface Extra {
  /** Every gift the desk reads from the start date, counting the households it leaves off. */
  mine: { n: number; leftOff: number };
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
        ['new', 'Letters still to mail'],
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
        ['Hold', 'Hold'],
        ['Printed', 'Printed'],
        ['Signed', 'Signed'],
        ['Mailed', 'Mailed'],
        ['Not mailing', 'Not mailing'],
      ],
      def: '',
    },
  ],
  columns: [
    { key: 'gdate', label: 'Gift date', type: 'date' },
    { key: 'partner', label: 'Partner', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'money', total: true },
    { key: 'fund', label: 'Fund', type: 'text' },
    { key: 'giver', label: 'Soft credited from', type: 'text' },
    { key: 'address', label: 'Preferred address', type: 'text' },
    { key: 'letter', label: 'Letter', type: 'chip' },
  ],
  note: 'The same gifts as the Work Center HQTY letters desk, from January 1, 2026. A letter counts as written when a completed HQTY Letter action sits on the giver or the partner on or after the gift, or the desk has it printed, signed or mailed. Hold means the partner has no address on record. Households whose every record is deceased or inactive are left off while their letter is still to write.',

  async load(ctx: ReportContext, f: Record<string, string>): Promise<Loaded> {
    const min = Number(f.min) || 5000;
    const [from0, to] = dateRange(ctx.today, f.preset);
    const from = from0 < DESK_SINCE ? DESK_SINCE : from0;
    const [{ shaped }, totalsRow] = await Promise.all([
      loadHqty(ctx.env, ctx.sql as never, { today: ctx.today, since: from }),
      ctx.sql<{ n: number; total: number }>(TOTALS_SQL, [5000, from, ctx.today]).then((r) => r[0] || { n: 0, total: 0 }),
    ]);

    const inRange = shaped.rows.filter((r) => r.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
    const all = inRange
      .filter((r) => r.amount >= min)
      .map(
        (r) =>
          ({
            gift_id: r.giftId,
            gdate: r.date,
            amount: r.amount,
            partner: r.partner.name,
            fund: r.fund,
            giver: r.through || '',
            address: r.address,
            letter: letterOf(r),
          }) as Row
      );

    const rows = all.filter((r) => {
      if (f.preset === 'new' && (r.letter === 'Mailed' || r.letter === 'Not mailing')) return false;
      if (f.letter && r.letter !== f.letter) return false;
      return true;
    });

    const extra: Extra = {
      mine: { n: shaped.rows.length, leftOff: shaped.stats.leftOff },
      independent: { n: Number(totalsRow.n), total: Number(totalsRow.total) },
    };
    return { rows, extra };
  },

  tie(_ctx, _rows, _f, extra): TieOut {
    const e = extra as Extra;
    return compare(
      'Gifts table, same start date and $5,000 minimum (separate query)',
      e.mine.n + e.mine.leftOff,
      e.independent.n,
      'count',
      `Desk gifts ${e.mine.n} plus ${e.mine.leftOff} left off as deceased or inactive households, gifts table ${e.independent.n}. No KPI figure exists for this list.`
    );
  },

  tiles(rows): Tile[] {
    const nm = rows.filter((r) => r.letter === 'Not mailed');
    const sum = (xs: Row[]) => xs.reduce((s, r) => s + Number(r.amount), 0);
    return [
      { label: 'Gifts', value: rows.length, kind: 'int', sub: money(sum(rows)) },
      { label: 'Letters to mail', value: nm.length, kind: 'int', sub: money(sum(nm)) },
      { label: 'On hold', value: rows.filter((r) => r.letter === 'Hold').length, kind: 'int', sub: 'No address on record' },
      { label: 'Soft credited', value: rows.filter((r) => r.giver).length, kind: 'int' },
    ];
  },
};

export default def;
