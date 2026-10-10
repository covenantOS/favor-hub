// Portfolio export. Replaces Full Portfolio Template (1084), Partner Data Template (1099), the per-director portfolio queries
// (1189 and the Email list builder 1177) and Annual Givers lists run for one director.
//
// A portfolio is the set of partners with an open fundraiser assignment (assignment end date blank) for the person asked
// for. Gift columns count each gift for the soft credit recipient, otherwise for the partner on the gift, the same credit rule
// as the KPI dashboard. Deceased partners are left out unless asked for. Inactive partners stay in, as in the saved queries.
import { noTie } from '../tieout';
import type { ReportDef, Tile } from '../types';
import { CREDIT_CTE, SQL_MARK, displayName, like, splitLines } from './lists-shared';

const TYPES: Array<[string, string, string]> = [
  ['', 'Any assignment', ''],
  ['rdd', 'Regional director', 'Regional Development Director'],
  ['pc', 'Partner Care', 'Partner Care'],
  ['church', 'Church engagement', 'Church Engagement'],
  ['foundation', 'Foundation steward', 'Foundation Steward'],
  ['prospect', 'Prospect steward', 'Prospect Steward'],
];

const def: ReportDef = {
  id: 'portfolio',
  pageSize: 500,
  filters: [
    { id: 'held', label: 'Held by', type: 'text', def: '' },
    { id: 'atype', label: 'Assignment', type: 'select', def: '', options: TYPES.map((t) => [t[0], t[1]] as [string, string]) },
    { id: 'state', label: 'State', type: 'text', def: '' },
    { id: 'bigmin', label: 'Largest gift at least ($)', type: 'text', def: '' },
    { id: 'gmin', label: 'A gift of at least ($)', type: 'text', def: '' },
    { id: 'gfrom', label: 'Gift on or after', type: 'date', def: '' },
    { id: 'gto', label: 'Gift on or before', type: 'date', def: '' },
    {
      id: 'show',
      label: 'Records',
      type: 'seg',
      def: 'current',
      options: [
        ['current', 'Living and inactive'],
        ['all', 'Include deceased'],
      ],
    },
  ],
  columns: [
    { key: 'lookup', label: 'Partner ID', type: 'id' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'held', label: 'Held by' },
    { key: 'atype', label: 'Assignment' },
    { key: 'firstDate', label: 'First gift date', type: 'date' },
    { key: 'firstAmt', label: 'First gift amount', type: 'money' },
    { key: 'lastDate', label: 'Last gift date', type: 'date' },
    { key: 'lastAmt', label: 'Last gift amount', type: 'money' },
    { key: 'bigDate', label: 'Largest gift date', type: 'date' },
    { key: 'bigAmt', label: 'Largest gift amount', type: 'money' },
    { key: 'total', label: 'Total giving', type: 'money', total: true },
    { key: 'n', label: 'Gifts', type: 'int', total: true },
    { key: 'line1', label: 'Address' },
    { key: 'line2', label: 'Unit' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'email', label: 'Email' },
    { key: 'phones', label: 'Phones' },
  ],
  note: 'One row for each partner, with every open assignment shown in Held by. A partner held by two people appears once.',
  fileTag: (f) => (f.held || 'all').toLowerCase().replace(/\s+/g, '-'),

  async load(ctx, f) {
    const params: unknown[] = [ctx.today];
    const p = (v: unknown) => {
      params.push(v);
      return '?' + params.length;
    };
    const asg: string[] = ['x.constituent_record_id = c.id', 'x.assignment_to_date IS NULL'];
    if (f.held) asg.push(`(COALESCE(fr.fundraiser_first_name, '') || ' ' || COALESCE(fr.fundraiser_last_name, '')) LIKE ${p(like(f.held.trim()))} ESCAPE '\\'`);
    const type = TYPES.find((t) => t[0] === f.atype);
    if (type && type[2]) asg.push(`x.assignment_type LIKE ${p('%' + type[2] + '%')}`);

    const where: string[] = [
      `EXISTS (SELECT 1 FROM assignments x LEFT JOIN fundraisers fr ON fr.id = x.assignment_fundraiser_id WHERE ${asg.join(' AND ')})`,
    ];
    if (f.show !== 'all') where.push('COALESCE(c.deceased, 0) = 0');
    if (f.state) where.push(`UPPER(a.address_state) = ${p(f.state.trim().toUpperCase())}`);
    const big = Number(f.bigmin.replace(/[$,\s]/g, ''));
    if (f.bigmin && Number.isFinite(big)) where.push(`COALESCE(b.a, 0) >= ${p(big)}`);
    const gmin = Number(f.gmin.replace(/[$,\s]/g, ''));
    if ((f.gmin && Number.isFinite(gmin)) || f.gfrom || f.gto) {
      const bits = ['cr.rid = c.id'];
      if (f.gmin && Number.isFinite(gmin)) bits.push(`cr.a >= ${p(gmin)}`);
      if (f.gfrom) bits.push(`cr.d >= ${p(f.gfrom)}`);
      if (f.gto) bits.push(`cr.d <= ${p(f.gto)}`);
      where.push(`EXISTS (SELECT 1 FROM cr WHERE ${bits.join(' AND ')})`);
    }

    const sql =
      SQL_MARK('portfolio') +
      CREDIT_CTE +
      `
SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.constituent_type AS type, c.first_name AS first, c.last_name AS last,
       c.organization_name AS org, c.spouse_first_name AS sf, c.spouse_last_name AS sl,
       fi.d AS firstDate, fi.a AS firstAmt, l.d AS lastDate, l.a AS lastAmt, b.d AS bigDate, b.a AS bigAmt, ROUND(l.total, 2) AS total, l.n AS n,
       a.address_lines AS lines, a.address_city AS city, a.address_state AS state, a.address_postal_code AS zip,
       (SELECT e.email_address FROM emails e WHERE e.id = c.primary_email_id) AS email,
       (SELECT group_concat(TRIM(COALESCE(ph.phone_type, '') || ' ' || ph.phone_number), '; ') FROM phones ph
         WHERE ph.constituent_record_id = c.id AND COALESCE(ph.is_inactive, 0) = 0 AND ph.phone_number IS NOT NULL) AS phones,
       (SELECT group_concat(DISTINCT CASE WHEN x.assignment_type LIKE '%Partner Care%' THEN 'Partner Care'
                                          ELSE TRIM(COALESCE(fr.fundraiser_first_name, '') || ' ' || COALESCE(fr.fundraiser_last_name, '')) END)
          FROM assignments x LEFT JOIN fundraisers fr ON fr.id = x.assignment_fundraiser_id
          WHERE x.constituent_record_id = c.id AND x.assignment_to_date IS NULL) AS held,
       (SELECT group_concat(DISTINCT x.assignment_type) FROM assignments x
          WHERE x.constituent_record_id = c.id AND x.assignment_to_date IS NULL) AS atype
FROM constituents c
LEFT JOIN addresses a ON a.id = c.primary_address_id
LEFT JOIN ranked l ON l.rid = c.id AND l.rl = 1
LEFT JOIN ranked fi ON fi.rid = c.id AND fi.rf = 1
LEFT JOIN ranked b ON b.rid = c.id AND b.rb = 1
WHERE ${where.join('\n  AND ')}
ORDER BY COALESCE(NULLIF(c.last_name, ''), c.organization_name), c.first_name`;
    const found = await ctx.sql(sql, params);
    const rows = found.map((r) => {
      const { line1, line2 } = splitLines(r.lines);
      return {
        lookup: r.lookup ?? '',
        name: displayName({ first: r.first as string, last: r.last as string, org: r.org as string, sf: r.sf as string, sl: r.sl as string }),
        type: r.type ?? '',
        held: r.held ?? '',
        atype: r.atype ?? '',
        firstDate: r.firstDate ?? null,
        firstAmt: r.firstAmt ?? null,
        lastDate: r.lastDate ?? null,
        lastAmt: r.lastAmt ?? null,
        bigDate: r.bigDate ?? null,
        bigAmt: r.bigAmt ?? null,
        total: Number(r.total) || 0,
        n: Number(r.n) || 0,
        line1,
        line2,
        city: r.city ?? '',
        state: r.state ?? '',
        zip: r.zip ?? '',
        email: r.email ?? '',
        phones: r.phones ?? '',
      };
    });
    return { rows };
  },

  tiles: (rows): Tile[] => [
    { label: 'Partners', value: rows.length, kind: 'int' },
    { label: 'Total giving', value: Math.round(rows.reduce((s, r) => s + (Number(r.total) || 0), 0) * 100) / 100, kind: 'money' },
  ],
  tie: async () => noTie(),
};

export default def;
