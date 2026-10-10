// Contact data lists. Replaces the Blackbaud data-health queries Constituents with Active Email Addresses (1114),
// Constituents with No Email Address (1115), Constituents with No Valid Email (1117) and Newly Added Constituents
// (284). New Constituents for ResearchPoint (1165) has the same rule, so it is the Newly added list (its Record ID column). The Online Express email signups query (433) filters on a custom
// field that the Blackbaud mirror does not hold, so it has no list here yet.
//
// Every list includes inactive and deceased records where the saved query does, and says so in the Status column.
import { noTie } from '../tieout';
import type { ReportContext, ReportDef, Row } from '../types';

const LISTS: Array<[string, string]> = [
  ['active-email', 'Active email address'],
  ['no-email', 'No email address'],
  ['no-valid-email', 'No valid email'],
  ['new', 'Newly added'],
];

interface Raw {
  cid: string;
  lookup: string | null;
  org: string | null;
  first: string | null;
  last: string | null;
  added: string | null;
  inactive: number;
  deceased: number;
  email: string | null;
  email_inactive: number | null;
  do_not_email: number | null;
  city: string | null;
  state: string | null;
}

const nameOf = (r: Raw) => (r.org || `${r.first || ''} ${r.last || ''}`).replace(/\s+/g, ' ').trim();
const status = (r: Raw) => (r.deceased ? 'Deceased' : r.inactive ? 'Inactive' : 'Active');

const SELECT = `SELECT c.id AS cid, c.constituent_lookup_id AS lookup, c.organization_name AS org, c.first_name AS first, c.last_name AS last,
       SUBSTR(c.date_added, 1, 10) AS added, c.inactive AS inactive, c.deceased AS deceased,
       a.address_city AS city, a.address_state AS state`;

const def: ReportDef = {
  id: 'contact',
  filters: [
    { id: 'list', label: 'List', type: 'select', def: 'active-email', options: LISTS },
    { id: 'month', label: 'Added in month', type: 'month', def: '', showWhen: { id: 'list', is: 'new' } },
  ],
  columns: [
    { key: 'record', label: 'Record ID', type: 'id' },
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'added', label: 'Added', type: 'date' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'status', label: 'Status' },
  ],
  pageSize: 200,
  fileTag: (f) => f.list,
  async load(ctx: ReportContext, f) {
    let raw: Raw[];
    if (f.list === 'active-email') {
      // One row per partner with an active email address, the primary address first.
      raw = await ctx.sql<Raw>(
        `${SELECT}, (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = c.id AND e.is_inactive = 0 AND COALESCE(e.email_address, '') <> ''
                     ORDER BY e.is_primary DESC, e.id LIMIT 1) AS email, NULL AS email_inactive, NULL AS do_not_email
         FROM constituents c LEFT JOIN addresses a ON a.id = c.primary_address_id
         WHERE EXISTS (SELECT 1 FROM emails e WHERE e.constituent_record_id = c.id AND e.is_inactive = 0 AND COALESCE(e.email_address, '') <> '')
         ORDER BY LOWER(email)`
      );
    } else if (f.list === 'no-email' || f.list === 'no-valid-email') {
      // No email row at all. A partner whose only addresses are marked inactive still has no valid email.
      const sql =
        f.list === 'no-email'
          ? `${SELECT}, NULL AS email, NULL AS email_inactive, NULL AS do_not_email
             FROM constituents c LEFT JOIN addresses a ON a.id = c.primary_address_id
             WHERE NOT EXISTS (SELECT 1 FROM emails e WHERE e.constituent_record_id = c.id AND COALESCE(e.email_address, '') <> '')
             ORDER BY LOWER(COALESCE(c.organization_name, c.last_name, '')), c.first_name`
          : `${SELECT}, (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = c.id AND COALESCE(e.email_address, '') <> '' ORDER BY e.id LIMIT 1) AS email,
                    NULL AS email_inactive, NULL AS do_not_email
             FROM constituents c LEFT JOIN addresses a ON a.id = c.primary_address_id
             WHERE NOT EXISTS (SELECT 1 FROM emails e WHERE e.constituent_record_id = c.id AND e.is_inactive = 0 AND COALESCE(e.email_address, '') <> '')
               AND EXISTS (SELECT 1 FROM emails e WHERE e.constituent_record_id = c.id AND COALESCE(e.email_address, '') <> '')
             ORDER BY LOWER(COALESCE(c.organization_name, c.last_name, '')), c.first_name`;
      raw = await ctx.sql<Raw>(sql);
    } else {
      // Newly added: added this month, inactive and deceased left out, like the saved queries.
      const month = f.month || ctx.today.slice(0, 7);
      raw = await ctx.sql<Raw>(
        `${SELECT}, (SELECT e.email_address FROM emails e WHERE e.id = c.primary_email_id) AS email, NULL AS email_inactive, NULL AS do_not_email
         FROM constituents c LEFT JOIN addresses a ON a.id = c.primary_address_id
         WHERE SUBSTR(c.date_added, 1, 7) = ? AND c.inactive = 0 AND c.deceased = 0
         ORDER BY c.date_added, LOWER(COALESCE(c.organization_name, c.last_name, '')), c.first_name`,
        [month]
      );
    }
    const rows: Row[] = raw.map((r) => ({
      record: r.lookup || r.cid,
      name: nameOf(r),
      email: r.email || '',
      added: r.added,
      city: r.city || '',
      state: r.state || '',
      status: status(r),
    }));
    return { rows };
  },
  totals: () => ({}),
  tiles(rows, f) {
    const label = (LISTS.find((l) => l[0] === f.list) || LISTS[0])[1];
    return [
      { label, value: rows.length, kind: 'int' },
      { label: 'Inactive or deceased', value: rows.filter((r) => r.status !== 'Active').length, kind: 'int' },
    ];
  },
  tie: async () => noTie(),
};

export default def;
