// Prayer list. Replaces query 563 Prayer List.
//
// The saved query asks for a gift dated inside a two-year window, total gifts of at least $0.01 counted inside a second window
// (saved as 2023-01-01 to 2025-01-31), a name that is not blank, and leaves out deceased and inactive partners. The last gift
// counts for the partner who gave it. Output is first name and name. Clearing the second window drops that rule.
import { noTie } from '../tieout';
import { addMonths, SQL_MARK } from './lists-shared';
import type { ReportDef, Tile } from '../types';

const def: ReportDef = {
  id: 'prayer',
  pageSize: 500,
  filters: [
    { id: 'from', label: 'Gift on or after (blank is two years back)', type: 'date', def: '' },
    { id: 'to', label: 'Gift on or before (blank is today)', type: 'date', def: '' },
    { id: 'tfrom', label: 'Total gifts from', type: 'date', def: '2023-01-01' },
    { id: 'tto', label: 'Total gifts through', type: 'date', def: '2025-01-31' },
  ],
  columns: [
    { key: 'first', label: 'First name' },
    { key: 'name', label: 'Name' },
  ],
  note: 'Total gifts of at least $0.01 is counted between the two "Total gifts" dates, as the saved query does. Clear both to drop that rule.',
  fileTag: (f) => f.from || '',

  async load(ctx, f) {
    const to = f.to || ctx.today;
    const from = f.from || addMonths(to, -24);
    const params: unknown[] = [from, to];
    let totalRule = '';
    if (f.tfrom && f.tto) {
      totalRule = `AND (SELECT COALESCE(SUM(t.gift_amount), 0) FROM gifts t WHERE t.constituent_record_id = c.id AND t.gift_type <> 'RecurringGift'
               AND t.gift_amount >= 0.01 AND DATE(t.gift_date) BETWEEN ? AND ?) >= 0.01`;
      params.push(f.tfrom, f.tto);
    }
    const sql =
      SQL_MARK('prayer') +
      `SELECT c.id AS id, c.first_name AS first, c.last_name AS last, c.organization_name AS org
       FROM constituents c
       WHERE COALESCE(c.inactive, 0) = 0 AND COALESCE(c.deceased, 0) = 0
         AND (COALESCE(c.first_name, '') <> '' OR COALESCE(c.last_name, '') <> '' OR COALESCE(c.organization_name, '') <> '')
         AND EXISTS (SELECT 1 FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_type <> 'RecurringGift'
               AND DATE(g.gift_date) BETWEEN ? AND ?)
         ${totalRule}
       ORDER BY COALESCE(NULLIF(c.last_name, ''), c.organization_name), c.first_name`;
    const found = await ctx.sql(sql, params);
    const rows = found.map((r) => {
      const first = String(r.first ?? '').trim();
      const last = String(r.last ?? '').trim();
      const org = String(r.org ?? '').trim();
      return { first, name: org && !first && !last ? org : `${first} ${last}`.trim() };
    });
    return { rows, asOf: to };
  },

  totals: () => ({}),
  tiles: (rows): Tile[] => [{ label: 'Names on the list', value: rows.length, kind: 'int' }],
  tie: async () => noTie('This list has no figure on the KPI dashboard. Its count matches the saved Prayer List query for the same dates.'),
};

export default def;
