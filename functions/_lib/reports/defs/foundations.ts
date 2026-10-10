// Foundations. Every foundation that has given or been awarded a grant, with its gifts for the year, its lifetime
// total, the grants awarded in the year and what the Grants tab counts as received. Replaces the Foundations List
// (1185), List of Foundations (2025 giving) (1095) and Partner foundations, highest to lowest (1126) queries.
//
// Awarded and received follow the KPI dashboard's Grants tab rule (backend/routes/teams.js grantAwards): an award is
// an Awarded grant request with its award date in the year, the larger of the expected and funded amounts. Received
// counts each funder's gifts, paid direct or soft-credited, dated on or after its first award of the year, up to the
// amount awarded. The tie-out reads the Grants tab's own answer.
import { kpiGet } from '../../hub/kpi';
import { compare, noTie } from '../tieout';
import type { ReportContext, ReportDef, Row, TieOut } from '../types';

const READER = { email: 'will@favorintl.org', name: 'Staff hub' };

// The year list is fixed text. A Worker reads the clock as 1970 until a request arrives, so nothing here may ask for the date.
const YEARS: Array<[string, string]> = Array.from({ length: 11 }, (_, i): [string, string] => [String(2030 - i), String(2030 - i)]);
const YEAR_OPTIONS: Array<[string, string]> = [['', 'This year'], ...YEARS, ['all', 'All years']];
const round2 = (n: number) => Math.round(n * 100) / 100;

const AWARD_AMOUNT = 'MAX(COALESCE(funded_amount, 0), COALESCE(expected_amount, 0))';
const AWARD_DATE = `MIN(
  COALESCE(SUBSTR(funded_date, 1, 10), '9999-12-31'),
  COALESCE(SUBSTR(expected_date, 1, 10), '9999-12-31'),
  COALESCE(SUBSTR(date_added, 1, 10), '9999-12-31')
)`;

interface Award { funder: string; awarded: number; award_date: string }
interface FunderGift { funder: string; id: string; gift_date: string; amount: number }

/** Awarded and received by funder for one year, by the Grants tab's rule. */
export async function grantsByFunder(ctx: ReportContext, year: number): Promise<Map<string, { awarded: number; received: number }>> {
  const awardWhere = `purpose = 'Grant Request' AND status LIKE 'Awarded%' AND inactive = 0 AND ${AWARD_AMOUNT} > 0
    AND ${AWARD_DATE} >= ? AND ${AWARD_DATE} < ?`;
  const lo = `${year}-01-01`;
  const hi = `${year + 1}-01-01`;
  const awards = await ctx.sql<Award>(
    `SELECT constituent_record_id AS funder, ${AWARD_AMOUNT} AS awarded, ${AWARD_DATE} AS award_date FROM opportunities WHERE ${awardWhere}`,
    [lo, hi]
  );
  const gifts = await ctx.sql<FunderGift>(
    `WITH funders AS (
       SELECT constituent_record_id AS funder, MIN(${AWARD_DATE}) AS first_award FROM opportunities WHERE ${awardWhere} GROUP BY constituent_record_id
     )
     SELECT f.funder AS funder, g.id AS id, DATE(g.gift_date) AS gift_date, g.gift_amount AS amount
     FROM funders f JOIN gifts g ON g.constituent_record_id = f.funder
     WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND DATE(g.gift_date) >= f.first_award AND g.gift_date < ?
     UNION
     SELECT f.funder, g.id, DATE(g.gift_date), g.gift_amount
     FROM funders f JOIN gifts g ON g.soft_credits IS NOT NULL
     JOIN json_each(g.soft_credits) sc ON sc.value ->> '$.constituent_id' = f.funder
     WHERE g.gift_amount > 0 AND g.gift_type <> 'RecurringGift' AND DATE(g.gift_date) >= f.first_award AND g.gift_date < ?`,
    [lo, hi, hi, hi]
  );
  const by = new Map<string, { awarded: number; received: number }>();
  for (const a of awards) {
    const cur = by.get(a.funder) || { awarded: 0, received: 0 };
    cur.awarded += Number(a.awarded) || 0;
    by.set(a.funder, cur);
  }
  [...gifts]
    .sort((a, b) => String(a.gift_date).localeCompare(String(b.gift_date)) || Number(a.id) - Number(b.id))
    .forEach((g) => {
      const f = by.get(g.funder);
      if (!f) return;
      const amount = Number(g.amount) || 0;
      f.received += Math.max(0, Math.min(amount, f.awarded - f.received));
    });
  return by;
}

interface Extra { year: string; awardedTotal: number; receivedTotal: number }

interface Raw {
  cid: string;
  lookup: string | null;
  org: string | null;
  first: string | null;
  last: string | null;
  added: string | null;
  gifts: number | null;
  total: number | null;
  lifetime: number | null;
  first_gift: string | null;
  last_gift: string | null;
  largest: number | null;
}

const def: ReportDef = {
  id: 'foundations',
  filters: [
    { id: 'year', label: 'Gift year', type: 'select', def: '', options: YEAR_OPTIONS },
    { id: 'show', label: 'Show', type: 'seg', def: 'all', options: [['all', 'All foundations'], ['new', 'Added this year']] },
  ],
  columns: [
    { key: 'record', label: 'ID', type: 'id' },
    { key: 'name', label: 'Foundation' },
    { key: 'added', label: 'Added', type: 'date' },
    { key: 'gifts', label: 'Gifts', type: 'int', total: true },
    { key: 'total', label: 'Given', type: 'money', total: true },
    { key: 'lifetime', label: 'Given, all years', type: 'money', total: true },
    { key: 'largest', label: 'Largest gift', type: 'money' },
    { key: 'first', label: 'First gift', type: 'date' },
    { key: 'last', label: 'Last gift', type: 'date' },
    { key: 'awarded', label: 'Awarded', type: 'money', total: true },
    { key: 'received', label: 'Counted as received', type: 'money', total: true },
  ],
  pageSize: 200,
  note: 'A foundation is a partner with the Foundation constituency code, or a funder with an award in the year. Awarded and Counted as received follow the Grants tab.',
  fileTag: (f) => f.year || 'this-year',
  async load(ctx: ReportContext, f) {
    const all = f.year === 'all';
    const year = Number(f.year || ctx.today.slice(0, 4));
    const lo = all ? '0000-01-01' : `${year}-01-01`;
    const hi = all ? '9999-12-31' : `${year + 1}-01-01`;
    const grants = all ? new Map<string, { awarded: number; received: number }>() : await grantsByFunder(ctx, year);
    const funderIds = [...grants.keys()];
    const idList = funderIds.length ? funderIds.map(() => '?').join(', ') : "''";
    const raw = await ctx.sql<Raw>(
      `WITH ids AS (
         SELECT DISTINCT constituent_record_id AS cid FROM constituent_codes WHERE json_extract(raw_json, '$.description') = 'Foundation' AND constituent_record_id IS NOT NULL
       )
       SELECT c.id AS cid, c.constituent_lookup_id AS lookup, c.organization_name AS org, c.first_name AS first, c.last_name AS last,
              SUBSTR(c.date_added, 1, 10) AS added,
              (SELECT COUNT(*) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_type <> 'RecurringGift' AND g.gift_amount > 0 AND g.gift_date >= ? AND g.gift_date < ?) AS gifts,
              (SELECT ROUND(COALESCE(SUM(g.gift_amount), 0), 2) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_type <> 'RecurringGift' AND g.gift_amount > 0 AND g.gift_date >= ? AND g.gift_date < ?) AS total,
              (SELECT ROUND(COALESCE(SUM(g.gift_amount), 0), 2) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_type <> 'RecurringGift' AND g.gift_amount > 0) AS lifetime,
              (SELECT SUBSTR(MIN(g.gift_date), 1, 10) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_type <> 'RecurringGift' AND g.gift_amount > 0) AS first_gift,
              (SELECT SUBSTR(MAX(g.gift_date), 1, 10) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_type <> 'RecurringGift' AND g.gift_amount > 0) AS last_gift,
              (SELECT MAX(g.gift_amount) FROM gifts g WHERE g.constituent_record_id = c.id AND g.gift_type <> 'RecurringGift' AND g.gift_amount > 0) AS largest
       FROM constituents c WHERE c.id IN (SELECT cid FROM ids) OR c.id IN (${idList})
       ORDER BY total DESC, lifetime DESC`,
      [lo, hi, lo, hi, ...funderIds]
    );
    const newFrom = `${ctx.today.slice(0, 4)}-01-01`;
    let rows: Row[] = raw.map((r) => {
      const g = grants.get(r.cid);
      return {
        record: r.lookup || r.cid,
        name: (r.org || `${r.first || ''} ${r.last || ''}`).replace(/\s+/g, ' ').trim(),
        added: r.added,
        gifts: Number(r.gifts) || 0,
        total: round2(Number(r.total) || 0),
        lifetime: round2(Number(r.lifetime) || 0),
        largest: r.largest === null ? null : round2(Number(r.largest)),
        first: r.first_gift,
        last: r.last_gift,
        awarded: g ? round2(g.awarded) : 0,
        received: g ? round2(g.received) : 0,
        cid: r.cid,
      };
    });
    if (f.show === 'new') rows = rows.filter((r) => String(r.added || '') >= newFrom);
    // The saved lists show a foundation once it has given or been awarded; a foundation with neither stays off.
    rows = rows.filter((r) => (r.lifetime as number) > 0 || (r.awarded as number) > 0);
    const extra: Extra = {
      year: all ? 'all' : String(year),
      awardedTotal: round2([...grants.values()].reduce((s, g) => s + g.awarded, 0)),
      receivedTotal: round2([...grants.values()].reduce((s, g) => s + g.received, 0)),
    };
    return { rows, extra };
  },
  tiles(rows, f, extra) {
    const x = extra as Extra;
    return [
      { label: 'Foundations', value: rows.length, kind: 'int' },
      { label: x.year === 'all' ? 'Given, all years' : `Given in ${x.year}`, value: round2(rows.reduce((s, r) => s + (Number(r.total) || 0), 0)), kind: 'money' },
      { label: 'Awarded', value: x.awardedTotal, kind: 'money' },
      { label: 'Counted as received', value: x.receivedTotal, kind: 'money' },
    ];
  },
  async tie(ctx: ReportContext, _rows, f, extra): Promise<TieOut> {
    const x = extra as Extra;
    if (x.year === 'all') return noTie('Choose a year to compare with the Grants tab.');
    const year = Number(x.year);
    const cur = Number(ctx.today.slice(0, 4));
    if (year !== cur && year !== cur - 1) return noTie('The Grants tab shows this year and last year only.');
    // The report keeps a funder only when its row shows (a foundation with an award always shows), so the
    // award figures here equal the full award list.
    let answer: { awards?: { awarded?: number; received?: number }; totals?: { lastYear?: { portfolio?: { giving?: Array<number | null> } } } };
    try {
      answer = await kpiGet(ctx.env, '/api/cf/grants', READER);
    } catch {
      return compare('KPI dashboard, Grants tab', x.receivedTotal, null, 'money');
    }
    if (year === cur) return compare(`KPI dashboard, Grants tab, received in ${year}`, x.receivedTotal, round2(Number(answer.awards?.received) || 0), 'money');
    const lastYear = (answer.totals?.lastYear?.portfolio?.giving || []).reduce((s, v) => s + (Number(v) || 0), 0);
    return compare(`KPI dashboard, Grants tab, awarded in ${year}`, x.awardedTotal, round2(lastYear), 'money');
  },
};

export default def;
