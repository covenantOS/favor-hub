// Annual tax receipt lists. Splits every partner who gave in a year into the mail list, the email list, the
// other list and the partners who get no receipt, so the three lists and the rest add up to the year's giving.
// Replaces the Annual Tax Receipts MAIL, EMAIL and OTHERS queries (1066, 1069, 1070). The statements themselves
// are a later wave.
//
// The saved queries use "total gifts last year of $250 or more", leave out constituencies Church, Foundation,
// Donor Advised Fund and DAF Provider, and sort by address and email:
//   Mail   a complete United States address.
//   Email  an email address and an incomplete address (or the Email Annual Tax Receipts solicit code).
//   Other  neither an email address nor a complete address (or the solicit code).
// Constituency comes from the partner's constituent codes. The solicit code Email Annual Tax Receipts comes from the
// solicit_codes mirror: a partner who carries it leaves the mail list.
//
// What counts as a valid mailing address (settled 2026-10-11 against query 1066 run for 2025: 649 of 649 partners match).
// The MAIL query leaves "include constituents with no valid addresses" off. That box is the constituent's own
// "no valid address" flag, which Blackbaud keeps on the record apart from the address rows (constituents.no_valid_address in
// the mirror, read by the sync worker's noValidAddress step). It is not the address's do-not-mail mark and not its inactive
// mark: 19 partners whose only address is marked do not mail are on the saved list because their flag is off, and 2 partners
// whose only address is inactive are off it because their flag is on. A tax receipt is not a solicitation, so do not mail
// does not keep a partner off the mail list. The EMAIL and OTHERS queries turn the box on, so the flag matters to the mail list only.
// A mail partner needs a complete United States preferred address and a flag that is off. A partner with a complete
// address and the flag on appears on none of the three saved lists; here that partner is listed under No receipt with the reason.
import { compare, noTie } from '../tieout';
import type { MailFile, ReportContext, ReportDef, Row, Tile, TieOut } from '../types';
import { stateName, moneyText, splitAddress, savedTie } from '../mailfile';
import { byText } from '../mailfile';

const MIN_TOTAL = 250;
const EXCLUDED_CONSTITUENCIES = ['Church', 'Foundation', 'Donor Advised Fund', 'DAF Provider'];

// The year list is fixed text. A Worker reads the clock as 1970 until a request arrives, so nothing here may ask for the date.
const YEARS: Array<[string, string]> = Array.from({ length: 11 }, (_, i): [string, string] => [String(2030 - i), String(2030 - i)]);

const LISTS: Array<[string, string]> = [
  ['mail', 'Mail'],
  ['email', 'Email'],
  ['other', 'Other'],
  ['none', 'No receipt'],
  ['all', 'Everyone who gave'],
];

const LIST_NAMES: Record<string, string> = { mail: 'Mail', email: 'Email', other: 'Other', none: 'No receipt' };
const round2 = (n: number) => Math.round(n * 100) / 100;
const moneyWords = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

interface Extra {
  year: string;
  through: string;
  /** Partner counts and dollars by list, before the list filter. */
  groups: Record<string, { count: number; total: number }>;
  all: number;
  /** False until the worker has read the no valid address flag. */
  flagRead: boolean;
  /** The mail list as plain facts for the saved-query tie. */
  mailCount: number;
  mailTotal: number;
  mailRows: Row[];
  /** Other-list partners with no address of any kind (no country on the record). */
  noAddress: { count: number; total: number };
}

interface Raw {
  cid: string;
  lookup: string | null;
  name: string | null;
  org: string | null;
  first: string | null;
  last: string | null;
  spouse_first: string | null;
  spouse_last: string | null;
  total: number;
  excluded: number;
  line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  dnm: number | null;
  nva: number | null;
  nva_read?: number | null;
  pa_name: string | null;
  raw_lines: string | null;
  etr: number;
  email: string | null;
}

const addressee = (r: Raw): string => {
  if ((r.pa_name || '').trim()) return r.pa_name as string;
  if (r.org) return r.org;
  const first = (r.first || '').trim();
  const last = (r.last || '').trim();
  const sf = (r.spouse_first || '').trim();
  const sl = (r.spouse_last || '').trim();
  if (sf && (!sl || sl.toLowerCase() === last.toLowerCase())) return `${first} and ${sf} ${last}`.replace(/\s+/g, ' ').trim();
  if (sf) return `${first} ${last} and ${sf} ${sl}`.replace(/\s+/g, ' ').trim();
  return `${first} ${last}`.replace(/\s+/g, ' ').trim() || (r.name || '').trim();
};

// The mail house file: the columns and values the saved query's own export had (Annual Tax Receipts - MAIL, query 1066),
// sorted by Primary Addressee as the query sorts.
const mailFile: MailFile = {
  label: 'Mail file',
  name: 'Annual tax receipts mail',
  columns: [
    { key: 'addressee', label: 'Primary Addressee' },
    { key: 'giving', label: "Last Year's Giving" },
    { key: 'block', label: 'Address Block' },
    { key: 'unit', label: 'Unit #' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP Code' },
    { key: 'qrecid', label: 'QRECID' },
  ],
  rows(_rows, _f, extra) {
    const x = extra as Extra;
    return [...x.mailRows]
      .sort((a, b) => byText(a.addressee, b.addressee))
      .map((r) => {
        const { block, unit } = splitAddress(r.rawLines);
        return { addressee: r.addressee, giving: moneyText(r.total), block, unit, city: r.city, state: stateName(r.state), zip: r.zip, qrecid: r.cid };
      });
  },
};

const def: ReportDef = {
  id: 'tax',
  filters: [
    { id: 'year', label: 'Gift year', type: 'select', def: '', options: [['', 'Last year'], ...YEARS] },
    { id: 'list', label: 'List', type: 'seg', def: 'mail', options: LISTS },
    { id: 'through', label: 'Gifts through month', type: 'month', def: '' },
  ],
  columns: [
    { key: 'lookup', label: 'ID', type: 'id' },
    { key: 'addressee', label: 'Addressee' },
    { key: 'list', label: 'List' },
    { key: 'total', label: 'Total gifts', type: 'money', total: true },
    { key: 'line', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'email', label: 'Email' },
    { key: 'why', label: 'Reason' },
  ],
  pageSize: 200,
  note: 'A partner is on a list when the year\'s total is $250 or more and the constituency is not Church, Foundation, Donor Advised Fund or DAF Provider. Everyone else who gave shows as No receipt with the reason. A do-not-mail address still gets a receipt by mail; only a partner Blackbaud marks as having no valid address is held back.',
  fileTag: (f) => `${f.year || 'last-year'}-${f.list}`,
  async load(ctx: ReportContext, f) {
    const year = Number(f.year || Number(ctx.today.slice(0, 4)) - 1);
    // The month filter cuts the gifts at the end of that month, inside the year chosen.
    let through = '';
    let upper = `${year + 1}-01-01`;
    if (f.through && f.through.slice(0, 4) === String(year)) {
      const m = Number(f.through.slice(5));
      through = f.through;
      upper = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
    }
    const placeholders = EXCLUDED_CONSTITUENCIES.map(() => '?').join(', ');
    const raw = await ctx.sql<Raw>(
      `WITH t AS (
         SELECT g.constituent_record_id AS cid, ROUND(SUM(g.gift_amount), 2) AS total,
                (SELECT COUNT(*) FROM constituent_codes k WHERE k.constituent_record_id = g.constituent_record_id
                   AND json_extract(k.raw_json, '$.description') IN (${placeholders})) AS excluded
         FROM gifts g
         WHERE g.gift_date >= ? AND g.gift_date < ? AND g.gift_type <> 'RecurringGift' AND g.gift_amount > 0
         GROUP BY g.constituent_record_id
       )
       SELECT t.cid AS cid, c.constituent_lookup_id AS lookup, c.organization_name AS org, c.first_name AS first, c.last_name AS last,
              c.spouse_first_name AS spouse_first, c.spouse_last_name AS spouse_last, t.total AS total, t.excluded AS excluded,
              c.primary_addressee AS pa_name, COALESCE(c.no_valid_address, 0) AS nva, (SELECT COUNT(*) FROM constituents WHERE no_valid_address = 1) AS nva_read, a.address_lines AS raw_lines, a.address_lines AS line, a.address_city AS city, a.address_state AS state, a.address_postal_code AS zip, a.address_country AS country, a.do_not_mail AS dnm,
              (SELECT COUNT(*) FROM solicit_codes s WHERE s.constituent_record_id = t.cid AND s.solicit_code = 'Email Annual Tax Receipts' AND (s.solicit_end IS NULL OR s.solicit_end > date('now'))) AS etr,
              (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = t.cid AND e.is_inactive = 0 AND COALESCE(e.email_address, '') <> ''
               ORDER BY e.is_primary DESC, e.id LIMIT 1) AS email
       FROM t
       LEFT JOIN constituents c ON c.id = t.cid
       LEFT JOIN addresses a ON a.id = c.primary_address_id
       ORDER BY LOWER(COALESCE(c.organization_name, c.last_name, '')), c.first_name`,
      [...EXCLUDED_CONSTITUENCIES, `${year}-01-01`, upper]
    );
    // Gifts with no partner record still count in the year's giving, so the tie-out keeps them.
    const unmatched = await ctx.sql<{ total: number }>(
      `SELECT ROUND(COALESCE(SUM(gift_amount), 0), 2) AS total FROM gifts
       WHERE gift_date >= ? AND gift_date < ? AND gift_type <> 'RecurringGift' AND gift_amount > 0 AND (constituent_record_id IS NULL OR constituent_record_id = '')`,
      [`${year}-01-01`, upper]
    );
    const groups: Extra['groups'] = { mail: { count: 0, total: 0 }, email: { count: 0, total: 0 }, other: { count: 0, total: 0 }, none: { count: 0, total: 0 } };
    const all: Row[] = [];
    const mailRows: Row[] = [];
    const noAddress = { count: 0, total: 0 };
    for (const r of raw) {
      const total = round2(Number(r.total) || 0);
      const complete = [r.line, r.city, r.state, r.zip].every((x) => (x || '').trim() !== '');
      const us = !r.country || r.country === 'United States';
      let list: string;
      let why = '';
      if (r.excluded) { list = 'none'; why = 'Church, foundation or DAF'; }
      else if (total < MIN_TOTAL) { list = 'none'; why = 'Under $250'; }
      else if (!us) { list = 'none'; why = 'Address outside the United States'; }
      else if (complete && !r.etr && r.nva) { list = 'none'; why = 'Blackbaud marks no valid address'; }
      else if (complete && !r.etr) list = 'mail';
      else if (r.email) list = 'email';
      else list = 'other';
      groups[list].count += 1;
      groups[list].total = round2(groups[list].total + total);
      const row: Row = {
        cid: r.cid,
        lookup: r.lookup || r.cid,
        addressee: addressee(r),
        list: LIST_NAMES[list],
        key: list,
        total,
        line: r.line || '',
        city: r.city || '',
        state: r.state || '',
        zip: r.zip || '',
        email: r.email || '',
        why,
        rawLines: r.raw_lines || '',
      };
      all.push(row);
      if (list === 'mail') mailRows.push(row);
      if (list === 'other' && !r.country && !(r.line || r.city || r.state || r.zip)) {
        noAddress.count += 1;
        noAddress.total = round2(noAddress.total + total);
      }
    }
    const unmatchedTotal = round2(Number(unmatched[0]?.total) || 0);
    const everything = round2(all.reduce((s, r) => s + (r.total as number), 0) + unmatchedTotal);
    const rows = f.list === 'all' ? all : all.filter((r) => r.key === f.list);
    const flagRead = raw.length === 0 || raw.some((r) => r.nva_read === undefined || Number(r.nva_read) > 0);
    const extra: Extra = { year: String(year), through, groups, all: everything, flagRead, mailCount: groups.mail.count, mailTotal: groups.mail.total, mailRows, noAddress };
    return { rows, extra };
  },
  tiles(rows, f, extra) {
    const x = extra as Extra;
    const flag: Tile[] = x.flagRead ? [] : [{ label: 'Valid-address flag', value: 'Not read yet', kind: 'text', sub: 'Mail counts include partners Blackbaud marks as having no valid address' }];
    return [
      { label: 'Mail', value: x.groups.mail.count, kind: 'int', sub: `$${Math.round(x.groups.mail.total).toLocaleString('en-US')}` },
      { label: 'Email', value: x.groups.email.count, kind: 'int', sub: `$${Math.round(x.groups.email.total).toLocaleString('en-US')}` },
      { label: 'Other', value: x.groups.other.count, kind: 'int', sub: `$${Math.round(x.groups.other.total).toLocaleString('en-US')}` },
      { label: 'No receipt', value: x.groups.none.count, kind: 'int', sub: `$${Math.round(x.groups.none.total).toLocaleString('en-US')}` },
      ...flag,
    ];
  },
  async ties(_ctx, _rows, f, extra): Promise<TieOut[]> {
    const x = extra as Extra;
    const lists = f.list === 'mail' || f.list === 'email' || f.list === 'other' ? [f.list] : f.list === 'all' ? ['mail', 'email', 'other'] : [];
    const out: TieOut[] = [];
    for (const list of lists) {
      let { count, total } = x.groups[list];
      let note = '';
      if (list === 'other' && x.noAddress.count) {
        // The saved OTHERS query needs the preferred country to be United States, so a partner with no address of any kind is on none of the saved lists.
        count -= x.noAddress.count;
        total = round2(total - x.noAddress.total);
        note = `${x.noAddress.count} more partner${x.noAddress.count === 1 ? '' : 's'} on this list ${x.noAddress.count === 1 ? 'has' : 'have'} no address of any kind (${moneyWords(x.noAddress.total)}); the saved query needs a United States address and leaves ${x.noAddress.count === 1 ? 'that partner' : 'them'} off.`;
      }
      out.push(...savedTie('tax', { year: x.year, through: x.through }, count, total, { list, note }));
    }
    return out;
  },
  mailFile,
  async tie(ctx: ReportContext, _rows, f, extra): Promise<TieOut> {
    const x = extra as Extra;
    // The KPI dashboard holds this year's months only. Every list and the partners with no receipt add up to the
    // year's giving, which is the figure it shows.
    if (Number(x.year) !== Number(ctx.today.slice(0, 4))) return noTie('The KPI dashboard shows this year only. Choose this year to compare.');
    const k = await ctx.kpi();
    if (!k) return compare('KPI dashboard, giving by month', x.all, null, 'money');
    const last = x.through ? Number(x.through.slice(5)) : 12;
    let kpi = 0;
    for (let i = 0; i < last; i++) kpi += k.monthlyGiving[i] || 0;
    return compare(x.through ? `KPI dashboard, giving January through month ${last}` : 'KPI dashboard, giving for the year to date', x.all, round2(kpi), 'money', 'Mail, email, other and no receipt together, every gift except recurring gift setups.');
  },
};

export default def;
