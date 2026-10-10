// Results by appeal. One row per appeal code with the gifts, partners and dollars it brought in, and a typed-in
// mailed quantity that Marketing enters per appeal (the count is not in Blackbaud). Replaces the Appeal Analysis,
// Direct Mail Appeal Performance, Digital Newsletters Performance and Campaign Performance Matrix queries.
//
// Gifts are counted the way the KPI dashboard's Marketing tab counts them: every gift split coded to an appeal in a
// marketing category, all gift types, dated in the year. The tie-out reads the Marketing tab's own answer.
import { kpiGet } from '../../hub/kpi';
import { compare, noTie } from '../tieout';
import type { ReportContext, ReportDef, Row, TieOut } from '../types';

// The Marketing tab's categories (backend/routes/marketing.js MARKETING_CATEGORIES). Keep the two lists identical.
export const MARKETING_CATEGORIES = [
  'book', 'digital newsletter', 'direct mail appeal', 'direct mail newsletter', 'e-blast',
  'event', 'flyer', 'acquisition', 'media', 'reactivation', 'speaking engagement', 'tv',
  'special mailout', 'thank you letter',
];
export const HEADLINE_CATEGORIES = ['Direct Mail Appeal', 'Digital Newsletter', 'Thank You Letter', 'Acquisition', 'Media'];

// Totals only, like the other KPI reads: the Marketing tab is limited to its team, so the hub reads it under a
// leadership account and the report page decides who sees the numbers.
const READER = { email: 'will@favorintl.org', name: 'Staff hub' };

const thisYear = new Date().getFullYear();
const YEARS: Array<[string, string]> = Array.from({ length: 6 }, (_, i) => [String(thisYear - i), String(thisYear - i)]);

const CATEGORY_OPTIONS: Array<[string, string]> = [
  ['marketing', 'All marketing categories'],
  ...HEADLINE_CATEGORIES.map((c): [string, string] => [c, c]),
  ['other', 'Other marketing categories'],
];

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** The category test as SQL: LOWER(category) in a list, or not in the headline list for Other. */
function categorySql(category: string): { where: string; params: string[] } {
  if (category === 'marketing') return { where: `LOWER(a.appeal_category) IN (${MARKETING_CATEGORIES.map(() => '?').join(', ')})`, params: [...MARKETING_CATEGORIES] };
  if (category === 'other') {
    const others = MARKETING_CATEGORIES.filter((c) => !HEADLINE_CATEGORIES.some((h) => h.toLowerCase() === c));
    return { where: `LOWER(a.appeal_category) IN (${others.map(() => '?').join(', ')})`, params: others };
  }
  return { where: 'LOWER(a.appeal_category) = ?', params: [category.toLowerCase()] };
}

interface Extra {
  year: string;
  category: string;
  through: string;
  mailedTotal: number;
}

const def: ReportDef = {
  id: 'appeal-results',
  filters: [
    { id: 'year', label: 'Gift year', type: 'select', def: String(thisYear), options: YEARS },
    { id: 'category', label: 'Appeal category', type: 'select', def: 'marketing', options: CATEGORY_OPTIONS },
    { id: 'through', label: 'Gifts through', type: 'date', def: '' },
  ],
  columns: [
    { key: 'code', label: 'Appeal' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'first', label: 'First gift', type: 'date' },
    { key: 'last', label: 'Last gift', type: 'date' },
    { key: 'gifts', label: 'Gifts', type: 'int', total: true },
    { key: 'partners', label: 'Partners', type: 'int' },
    { key: 'raised', label: 'Raised', type: 'money', total: true },
    { key: 'avg', label: 'Average gift', type: 'money' },
    { key: 'mailed', label: 'Mailed', type: 'cell' },
    { key: 'rate', label: 'Response', type: 'pct' },
  ],
  pageSize: 200,
  editable: { keyOf: (r) => String(r.code), columns: ['mailed'] },
  note: 'Mailed is typed in per appeal. Response is gifts divided by mailed.',
  fileTag: (f) => `${f.year}${f.category === 'marketing' ? '' : '-' + f.category.toLowerCase().replace(/\s+/g, '-')}`,
  async load(ctx: ReportContext, f) {
    const year = Number(f.year);
    const end = f.through && f.through >= `${year}-01-01` && f.through < `${year + 1}-01-01` ? f.through : '';
    // The gift date column holds a timestamp, so "through" is the day after.
    const upper = end ? new Date(Date.parse(end + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10) : `${year + 1}-01-01`;
    const cat = categorySql(f.category);
    const rows = await ctx.sql<{ code: string; description: string; category: string; gifts: number; partners: number; raised: number; first: string; last: string }>(
      `SELECT a.appeal_id AS code, a.appeal_description AS description, a.appeal_category AS category,
              COUNT(*) AS gifts, COUNT(DISTINCT g.constituent_record_id) AS partners,
              ROUND(SUM(json_extract(s.value, '$.amount.value')), 2) AS raised,
              SUBSTR(MIN(g.gift_date), 1, 10) AS first, SUBSTR(MAX(g.gift_date), 1, 10) AS last
       FROM gifts g, json_each(g.gift_splits) s
       JOIN appeals a ON a.id = json_extract(s.value, '$.appeal_id')
       WHERE g.gift_date >= ? AND g.gift_date < ? AND ${cat.where}
       GROUP BY a.id ORDER BY raised DESC`,
      [`${year}-01-01`, upper, ...cat.params]
    );
    let mailedTotal = 0;
    const out: Row[] = rows.map((r) => {
      const raised = money(r.raised);
      const gifts = Number(r.gifts) || 0;
      const typed = ctx.edits[`${r.code}|mailed`];
      const mailed = typed === undefined || typed === '' ? null : Number(typed);
      if (mailed) mailedTotal += mailed;
      return {
        code: r.code,
        description: r.description || '',
        category: r.category || '',
        first: r.first,
        last: r.last,
        gifts,
        partners: Number(r.partners) || 0,
        raised,
        avg: gifts ? money(raised / gifts) : null,
        mailed,
        rate: mailed ? gifts / mailed : null,
      };
    });
    const extra: Extra = { year: f.year, category: f.category, through: end, mailedTotal };
    return { rows: out, extra };
  },
  tiles(rows, _f, extra) {
    const x = extra as Extra;
    const raised = rows.reduce((s, r) => s + (Number(r.raised) || 0), 0);
    const gifts = rows.reduce((s, r) => s + (Number(r.gifts) || 0), 0);
    const mailedRows = rows.filter((r) => Number(r.mailed) > 0);
    const mailedGifts = mailedRows.reduce((s, r) => s + (Number(r.gifts) || 0), 0);
    return [
      { label: 'Raised', value: money(raised), kind: 'money' },
      { label: 'Gifts', value: gifts, kind: 'int' },
      { label: 'Appeals', value: rows.length, kind: 'int' },
      { label: 'Mailed (typed in)', value: x.mailedTotal, kind: 'int' },
      { label: 'Response', value: x.mailedTotal ? `${((mailedGifts / x.mailedTotal) * 100).toFixed(1)}%` : '', kind: 'text' },
    ];
  },
  async tie(ctx: ReportContext, rows, f, extra): Promise<TieOut> {
    const x = extra as Extra;
    // A date cut-off or a category group the dashboard does not publish has no figure to compare.
    if (x.through) return noTie('A report cut off at a date has no matching figure on the KPI dashboard.');
    let answer: { byCategory?: Record<string, { giving?: number[] }> };
    try {
      answer = await kpiGet(ctx.env, `/api/cf/marketing/report?year=${encodeURIComponent(f.year)}`, READER);
    } catch {
      return compare('KPI dashboard, Marketing tab', rows.reduce((s, r) => s + (Number(r.raised) || 0), 0), null, 'money');
    }
    const by = answer.byCategory || {};
    const sum = (key: string) => (by[key]?.giving || []).reduce((s, v) => s + (Number(v) || 0), 0);
    let kpi: number;
    let label: string;
    if (f.category === 'marketing') {
      kpi = Object.keys(by).reduce((s, k) => s + sum(k), 0);
      label = `KPI dashboard, Marketing tab, revenue by appeal category, ${f.year}`;
    } else if (f.category === 'other') {
      kpi = sum('Other marketing');
      label = `KPI dashboard, Marketing tab, Other marketing, ${f.year}`;
    } else {
      kpi = sum(f.category);
      label = `KPI dashboard, Marketing tab, ${f.category}, ${f.year}`;
    }
    return compare(label, rows.reduce((s, r) => s + (Number(r.raised) || 0), 0), money(kpi), 'money');
  },
};

export default def;
