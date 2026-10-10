// Appeal mailing list. Replaces Appeal List Format (795), Appeal general mail list format (358), Email list builder CSVs (1177)
// and the state, source and director lists (1055, 1196, 854).
//
// The filters are the saved ones: a preferred address with line 1, city, state and ZIP and send mail turned on, the last gift
// asked at run time (date and amount), deceased and inactive partners left out, and the constituency codes Church, Foundation,
// Donor Advised Fund, School, Ministry, Business and International Entity left out. The last gift counts for the partner who
// gave it (the "Donor" soft credit option of the saved query). Do-not-mail addresses never appear.
import { noTie } from '../tieout';
import type { ReportDef, Tile } from '../types';
import { SQL_MARK, displayName, like, salutation, splitLines } from './lists-shared';

const EXCLUDED_CODES = ['Church', 'Foundation', 'Donor Advised Fund', 'School', 'Ministry', 'Business', 'International Entity'];

const def: ReportDef = {
  id: 'mailing',
  pageSize: 500,
  filters: [
    {
      id: 'kind',
      label: 'Who',
      type: 'seg',
      def: 'partners',
      options: [
        ['partners', 'Partners'],
        ['all', 'Partners and organizations'],
      ],
    },
    { id: 'from', label: 'Last gift on or after', type: 'date', def: '' },
    { id: 'to', label: 'Last gift on or before', type: 'date', def: '' },
    { id: 'min', label: 'Last gift at least ($)', type: 'text', def: '' },
    { id: 'state', label: 'State', type: 'text', def: '' },
    { id: 'held', label: 'Held by', type: 'text', def: '' },
    { id: 'appeal', label: 'Gave to appeal code', type: 'text', def: '' },
  ],
  columns: [
    { key: 'lookup', label: 'Partner ID', type: 'id' },
    { key: 'salutation', label: 'Salutation' },
    { key: 'addressee', label: 'Addressee' },
    { key: 'org', label: 'Organization' },
    { key: 'line1', label: 'Address line 1' },
    { key: 'line2', label: 'Address line 2' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'lastDate', label: 'Last gift date', type: 'date' },
    { key: 'lastAmt', label: 'Last gift amount', type: 'money' },
  ],
  note: 'One row for each partner with a mailable address. Do-not-mail addresses, deceased and inactive partners are left out. Salutation and addressee are built from the names on the record.',
  fileTag: (f) => [f.state, f.from].filter(Boolean).join('-'),

  async load(ctx, f) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.from) {
      where.push('lg.d >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('lg.d <= ?');
      params.push(f.to);
    }
    const min = Number(f.min.replace(/[$,\s]/g, ''));
    if (f.min && Number.isFinite(min)) {
      where.push('lg.amt >= ?');
      params.push(min);
    }
    if (f.state) {
      where.push('UPPER(a.address_state) = ?');
      params.push(f.state.trim().toUpperCase());
    }
    if (f.held) {
      where.push(
        `EXISTS (SELECT 1 FROM assignments x JOIN fundraisers fr ON fr.id = x.assignment_fundraiser_id
           WHERE x.constituent_record_id = c.id AND x.assignment_to_date IS NULL
             AND (COALESCE(fr.fundraiser_first_name, '') || ' ' || COALESCE(fr.fundraiser_last_name, '')) LIKE ? ESCAPE '\\')`,
      );
      params.push(like(f.held.trim()));
    }
    if (f.appeal) {
      where.push(
        `EXISTS (SELECT 1 FROM gifts gg, json_each(CASE WHEN json_valid(gg.gift_splits) THEN gg.gift_splits ELSE '[]' END) js
           JOIN appeals ap ON ap.id = json_extract(js.value, '$.appeal_id')
           WHERE gg.constituent_record_id = c.id AND UPPER(ap.appeal_id) = ?)`,
      );
      params.push(f.appeal.trim().toUpperCase());
    }
    if (f.kind !== 'all') {
      where.push(
        `NOT EXISTS (SELECT 1 FROM constituent_codes cc WHERE cc.constituent_record_id = c.id
           AND json_extract(cc.raw_json, '$.description') IN (${EXCLUDED_CODES.map((x) => `'${x}'`).join(', ')}))`,
      );
    }
    const sql =
      SQL_MARK('mailing') +
      `WITH lg AS (
         SELECT constituent_record_id AS cid, gift_amount AS amt, DATE(gift_date) AS d,
                ROW_NUMBER() OVER (PARTITION BY constituent_record_id ORDER BY DATE(gift_date) DESC, CAST(id AS INTEGER) DESC) AS rn
         FROM gifts WHERE gift_type <> 'RecurringGift' AND gift_date IS NOT NULL AND gift_amount IS NOT NULL
       )
       SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.first_name AS first, c.last_name AS last, c.organization_name AS org,
              c.spouse_first_name AS sf, c.spouse_last_name AS sl, a.address_lines AS lines, a.address_city AS city,
              a.address_state AS state, a.address_postal_code AS zip, lg.d AS lastDate, lg.amt AS lastAmt
       FROM lg JOIN constituents c ON c.id = lg.cid JOIN addresses a ON a.id = c.primary_address_id
       WHERE lg.rn = 1 AND COALESCE(c.inactive, 0) = 0 AND COALESCE(c.deceased, 0) = 0
         AND COALESCE(a.do_not_mail, 0) = 0
         AND TRIM(COALESCE(a.address_lines, '')) <> '' AND TRIM(COALESCE(a.address_city, '')) <> ''
         AND TRIM(COALESCE(a.address_state, '')) <> '' AND TRIM(COALESCE(a.address_postal_code, '')) <> ''
         ${where.map((w) => 'AND ' + w).join('\n         ')}
       ORDER BY COALESCE(NULLIF(c.last_name, ''), c.organization_name), c.first_name`;
    const found = await ctx.sql(sql, params);
    const rows = found.map((r) => {
      const { line1, line2 } = splitLines(r.lines);
      const p = { first: r.first as string, last: r.last as string, org: r.org as string, sf: r.sf as string, sl: r.sl as string };
      return {
        lookup: r.lookup ?? '',
        salutation: salutation(p),
        addressee: displayName(p),
        org: r.org ?? '',
        line1,
        line2,
        city: r.city ?? '',
        state: r.state ?? '',
        zip: r.zip ?? '',
        lastDate: r.lastDate,
        lastAmt: Number(r.lastAmt),
      };
    });
    return { rows };
  },

  totals: () => ({}),
  tiles: (rows): Tile[] => [{ label: 'Partners to mail', value: rows.length, kind: 'int' }],
  tie: async () => noTie(),
};

export default def;
