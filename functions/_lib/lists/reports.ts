// The standard reports. Each one reads the lr_* snapshot (counts in milliseconds), takes a period, ties to the KPI dashboard where a matching
// figure exists, and gives every row a drill spec the Lists page opens to show the partners or gifts behind it.
import { addMonthsSql, emptySpec, normalizeSpec, type ListSpec } from './criteria.ts';
import type { Q, Tie } from './run.ts';

type Row = Record<string, any>;
export interface ReportCol {
  key: string;
  label: string;
  type: 'text' | 'int' | 'money' | 'pct' | 'date';
}
export interface Param {
  id: string;
  label: string;
  type: 'period' | 'select';
  options?: Array<[string, string]>;
  def: string;
}
export interface Tile {
  label: string;
  value: number | string;
  kind: 'int' | 'money' | 'text';
}
export interface ReportResult {
  columns: ReportCol[];
  rows: Row[];
  tiles: Tile[];
  ties: Tie[];
  note?: string;
}
export interface Kpi {
  monthlyGiving: Array<number | null>;
  ytdRevenue: number | null;
  status: { active: number; lybunt: number; lapsed: number } | null;
}
export interface Ctx {
  q: Q;
  today: string;
  from: string;
  to: string;
  p: Record<string, string>;
  kpi: Kpi | null;
  /** Read-only SQL on the Blackbaud mirror, for the two reports whose data is not in the snapshot. */
  mirror?: Q;
}
export interface ReportDef {
  id: string;
  name: string;
  group: 'Giving' | 'Partners' | 'Team';
  about: string;
  params: Param[];
  run(c: Ctx): Promise<ReportResult>;
}

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const ge = (from: string) => (from ? 'AND gift_date >= ?' : '');
export const yearStart = (today: string) => `${today.slice(0, 4)}-01-01`;

const gifts = (over: Partial<ListSpec['gift']> = {}, partner: Partial<ListSpec['partner']> = {}): ListSpec => {
  const s = emptySpec('gifts');
  Object.assign(s.gift, over);
  Object.assign(s.partner, { deceased: 'include' }, partner);
  return s;
};
const partners = (partner: Partial<ListSpec['partner']>): ListSpec => {
  const s = emptySpec('partners');
  Object.assign(s.partner, partner);
  return s;
};

function tieMoney(label: string, mine: number, kpi: number | null | undefined): Tie {
  if (kpi == null) return { label, mine, kpi: null, status: 'unavailable' };
  const same = Math.abs(r2(mine) - r2(kpi)) < 0.005;
  return { label, mine, kpi, status: same ? 'match' : 'differs', note: same ? undefined : `Difference ${r2(mine - kpi).toLocaleString('en-US')}` };
}

const DIM: Record<string, { label: string; sql: string; drill: (v: string) => Partial<ListSpec['gift']> | null }> = {
  fund: { label: 'Fund', sql: `COALESCE(NULLIF(fund_names, ''), 'No fund')`, drill: () => null },
  appeal_cat: { label: 'Appeal category', sql: `COALESCE(NULLIF(trim(appeal_cats, '|'), ''), 'No appeal')`, drill: (v) => (v === 'No appeal' ? null : { appealCats: [v.split('|')[0]] }) },
  appeal: { label: 'Appeal', sql: `COALESCE(NULLIF(appeal_codes, ''), 'No appeal')`, drill: () => null },
  month: { label: 'Month', sql: `substr(gift_date, 1, 7)`, drill: () => null },
  kind: { label: 'Gift type', sql: `CASE kind WHEN 'recurring' THEN 'Recurring' ELSE 'One-time' END`, drill: (v) => ({ kinds: [v === 'Recurring' ? 'recurring' : 'one_time'] }) },
};

const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

const giving: ReportDef = {
  id: 'giving',
  name: 'Giving by fund, appeal and month',
  group: 'Giving',
  about: 'Every gift in the period, grouped. The total ties to the KPI dashboard.',
  params: [
    { id: 'period', label: 'Period', type: 'period', def: 'ytd' },
    { id: 'by', label: 'Group by', type: 'select', def: 'month', options: [['month', 'Month'], ['fund', 'Fund'], ['appeal', 'Appeal'], ['appeal_cat', 'Appeal category'], ['kind', 'One-time and recurring']] },
  ],
  async run(c) {
    const d = DIM[c.p.by] || DIM.month;
    const rows = await c.q(
      `SELECT ${d.sql} AS k, COUNT(*) AS gifts, ROUND(SUM(amount), 2) AS total, ROUND(SUM(CASE WHEN kind = 'recurring' THEN amount ELSE 0 END), 2) AS recurring
         FROM lr_g1 WHERE gift_date >= ?1 AND gift_date <= ?2 GROUP BY 1 ORDER BY ${c.p.by === 'month' ? '1' : '3 DESC'} LIMIT 400`,
      [c.from, c.to]
    );
    const total = r2(rows.reduce((s, r) => s + n(r.total), 0));
    const count = rows.reduce((s, r) => s + n(r.gifts), 0);
    const ties: Tie[] = [];
    if (c.kpi && c.to === c.today) {
      const todays = r2(n((await c.q(`SELECT COALESCE(SUM(amount), 0) AS t FROM lr_g1 WHERE gift_date = ?1`, [c.today]))[0]?.t));
      const withNote = (t: Tie): Tie => (t.status === 'differs' && t.kpi != null && Math.abs(r2(t.mine - t.kpi) - todays) < 0.005 && todays > 0 ? { ...t, note: `The difference is gifts dated today (${todays.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}) that the dashboard's last build did not have.` } : t);
      if (c.from === yearStart(c.today)) ties.push(withNote(tieMoney('KPI dashboard, Executive, year-to-date revenue', total, c.kpi.ytdRevenue)));
      else if (c.from === c.today.slice(0, 8) + '01') ties.push(withNote(tieMoney('KPI dashboard, all sources, this month', total, c.kpi.monthlyGiving[Number(c.today.slice(5, 7)) - 1])));
    }
    return {
      columns: [
        { key: 'k', label: d.label, type: 'text' },
        { key: 'gifts', label: 'Gifts', type: 'int' },
        { key: 'total', label: 'Total', type: 'money' },
        { key: 'recurring', label: 'Of it recurring', type: 'money' },
      ],
      rows: rows.map((r) => {
        const key = String(r.k);
        let drill: ListSpec | null = null;
        if (c.p.by === 'month' && /^\d{4}-\d{2}$/.test(key)) drill = gifts({ from: key + '-01', to: monthEnd(key) });
        else if (c.p.by === 'fund') drill = null;
        else if (DIM[c.p.by]) {
          const extra = DIM[c.p.by].drill(key);
          if (extra) drill = gifts({ from: c.from, to: c.to, ...extra });
        }
        return { ...r, _drill: drill };
      }),
      tiles: [{ label: 'Total', value: total, kind: 'money' }, { label: 'Gifts', value: count, kind: 'int' }],
      ties,
    };
  },
};

const credit: ReportDef = {
  id: 'credit',
  name: 'Credit by fundraiser',
  group: 'Team',
  about: 'Fundraiser credit on gifts in the period, split into one-time and recurring. A gift shared by two fundraisers counts in full for each.',
  params: [{ id: 'period', label: 'Period', type: 'period', def: 'ytd' }],
  async run(c) {
    const rows = await c.q(
      `SELECT x.fundraiser_id AS fid, COALESCE(f.name, x.fundraiser_id) AS name, COALESCE(f.ftype, '') AS role,
              ROUND(SUM(CASE WHEN x.kind = 'one_time' THEN x.amount ELSE 0 END), 2) AS one_time, ROUND(SUM(CASE WHEN x.kind = 'recurring' THEN x.amount ELSE 0 END), 2) AS recurring,
              ROUND(SUM(x.amount), 2) AS total, COUNT(*) AS gifts
         FROM lr_cr x LEFT JOIN lr_fr f ON f.id = x.fundraiser_id WHERE x.gift_date >= ?1 AND x.gift_date <= ?2 GROUP BY x.fundraiser_id ORDER BY total DESC`,
      [c.from, c.to]
    );
    const none = await c.q(
      `SELECT COUNT(*) AS gifts, ROUND(COALESCE(SUM(amount), 0), 2) AS total FROM lr_g1 g WHERE gift_date >= ?1 AND gift_date <= ?2 AND NOT EXISTS (SELECT 1 FROM lr_cr x WHERE x.gift_id = g.gift_id)`,
      [c.from, c.to]
    );
    const out = rows.map((r) => ({ ...r, _drill: gifts({ from: c.from, to: c.to, creditedTo: [String(r.fid)] }) }));
    const sum = (k: string) => r2(rows.reduce((s, r) => s + n(r[k]), 0));
    return {
      columns: [
        { key: 'name', label: 'Fundraiser', type: 'text' },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'one_time', label: 'One-time', type: 'money' },
        { key: 'recurring', label: 'Recurring', type: 'money' },
        { key: 'total', label: 'Credit', type: 'money' },
        { key: 'gifts', label: 'Gifts', type: 'int' },
      ],
      rows: out,
      tiles: [
        { label: 'Credited', value: sum('total'), kind: 'money' },
        { label: 'One-time', value: sum('one_time'), kind: 'money' },
        { label: 'Recurring', value: sum('recurring'), kind: 'money' },
        { label: 'Gifts with no credit', value: n(none[0]?.gifts), kind: 'int' },
      ],
      ties: [],
      note: `Gifts with no fundraiser credit: ${n(none[0]?.gifts).toLocaleString('en-US')} gifts, ${r2(n(none[0]?.total)).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} (marketing appeals carry none by design).`,
    };
  },
};

const portfolio: ReportDef = {
  id: 'portfolio',
  name: 'Portfolio by holder',
  group: 'Team',
  about: 'Partners each person holds today, by status. A partner with two holders counts under each.',
  params: [{ id: 'role', label: 'Role', type: 'select', def: 'Regional Development Director (RDD)', options: [['Regional Development Director (RDD)', 'RDD'], ['Partner Care', 'Partner Care'], ['Church Engagement Director', 'Church Engagement'], ['Prospect Steward', 'Prospect Steward'], ['Foundation Steward', 'Foundation Steward']] }],
  async run(c) {
    const t12 = addMonthsSql(c.today, -12);
    const t24 = addMonthsSql(c.today, -24);
    const rows = await c.q(
      `SELECT x.fundraiser_id AS fid, COALESCE(f.name, x.fundraiser_id) AS name, COUNT(*) AS held,
              SUM(h.last_gift > ?2) AS active, SUM(h.last_gift <= ?2 AND h.last_gift > ?3) AS lybunt, SUM(h.last_gift <= ?3) AS lapsed,
              SUM(h.largest >= 1000) AS major, ROUND(SUM(h.lifetime), 2) AS lifetime
         FROM lr_holder x JOIN lr_hh h ON h.household_id = x.household_id LEFT JOIN lr_fr f ON f.id = x.fundraiser_id
        WHERE x.atype = ?1 AND h.alive = 1 GROUP BY x.fundraiser_id ORDER BY held DESC`,
      [c.p.role, t12, t24]
    );
    return {
      columns: [
        { key: 'name', label: 'Holder', type: 'text' },
        { key: 'held', label: 'Partners', type: 'int' },
        { key: 'active', label: 'Active', type: 'int' },
        { key: 'lybunt', label: 'LYBUNT', type: 'int' },
        { key: 'lapsed', label: 'Lapsed', type: 'int' },
        { key: 'major', label: 'Major', type: 'int' },
        { key: 'lifetime', label: 'Lifetime giving', type: 'money' },
      ],
      rows: rows.map((r) => ({ ...r, _drill: partners({ holders: [String(r.fid)], holderTypes: [c.p.role] }) })),
      tiles: [{ label: 'Held partners', value: rows.reduce((s, r) => s + n(r.held), 0), kind: 'int' }],
      ties: [],
    };
  },
};

const newLost: ReportDef = {
  id: 'new-lost',
  name: 'New and lost partners',
  group: 'Partners',
  about: 'New: first gift in the period. Lost: the last gift passed 24 months old during the period, so the partner became lapsed.',
  params: [{ id: 'period', label: 'Period', type: 'period', def: 'ytd' }],
  async run(c) {
    const lostFrom = addMonthsSql(c.from, -24);
    const lostTo = addMonthsSql(c.to, -24);
    const months = await c.q(
      `SELECT substr(first_gift, 1, 7) AS k, COUNT(*) AS n, ROUND(SUM(lifetime), 2) AS t FROM lr_hh WHERE alive = 1 AND first_gift >= ?1 AND first_gift <= ?2 GROUP BY 1 ORDER BY 1`,
      [c.from, c.to]
    );
    const lost = await c.q(`SELECT substr(last_gift, 1, 7) AS k, COUNT(*) AS n FROM lr_hh WHERE alive = 1 AND last_gift > ?1 AND last_gift <= ?2 GROUP BY 1 ORDER BY 1`, [lostFrom, lostTo]);
    const lostBy = new Map(lost.map((r) => [String(r.k), n(r.n)]));
    const rows = months.map((r) => {
      const k = String(r.k);
      const lm = addMonthsSql(k + '-01', 24).slice(0, 7);
      return { k, newN: n(r.n), newT: n(r.t), lostN: lostBy.get(lm) ?? 0, _drill: partners({ firstGift: { from: k + '-01', to: monthEnd(k) } }) };
    });
    const newTotal = months.reduce((s, r) => s + n(r.n), 0);
    const lostTotal = lost.reduce((s, r) => s + n(r.n), 0);
    return {
      columns: [
        { key: 'k', label: 'Month of first gift', type: 'text' },
        { key: 'newN', label: 'New partners', type: 'int' },
        { key: 'newT', label: 'Their giving so far', type: 'money' },
      ],
      rows,
      tiles: [
        { label: 'New partners', value: newTotal, kind: 'int' },
        { label: 'Became lapsed', value: lostTotal, kind: 'int' },
        { label: 'Net', value: newTotal - lostTotal, kind: 'int' },
      ],
      ties: [],
      note: 'Became lapsed counts partners whose last gift is 24 months old inside the period.',
    };
  },
};

const status: ReportDef = {
  id: 'status',
  name: 'LYBUNT and lapsed by how they came in',
  group: 'Partners',
  about: 'Status counts today and the same day last year, split by whether the first gift was an acquisition appeal. Ties to the KPI dashboard.',
  params: [],
  async run(c) {
    const t12 = addMonthsSql(c.today, -12);
    const t24 = addMonthsSql(c.today, -24);
    const ly = addMonthsSql(c.today, -12);
    const rows = await c.q(
      `SELECT CASE WHEN last_gift > ?1 THEN 'active' WHEN last_gift > ?2 THEN 'lybunt' ELSE 'lapsed' END AS s,
              CASE WHEN COALESCE(first_cat, '') = 'Acquisition' THEN 'Acquisition' ELSE 'Other' END AS src, COUNT(*) AS n
         FROM lr_hh WHERE alive = 1 GROUP BY 1, 2`,
      [t12, t24]
    );
    const then = await c.q(
      `SELECT CASE WHEN last_gift_ly IS NULL THEN 'none' WHEN last_gift_ly > ?2 THEN 'active' WHEN last_gift_ly > ?3 THEN 'lybunt' ELSE 'lapsed' END AS s,
              CASE WHEN COALESCE(first_cat, '') = 'Acquisition' THEN 'Acquisition' ELSE 'Other' END AS src, COUNT(*) AS n
         FROM lr_hh WHERE alive = 1 GROUP BY 1, 2`,
      [ly, t24, addMonthsSql(ly, -24)]
    );
    const get = (rs: Row[], s: string, src: string) => n(rs.find((r) => r.s === s && r.src === src)?.n);
    const out: Row[] = [];
    const ties: Tie[] = [];
    for (const s of ['lybunt', 'lapsed', 'active'] as const) {
      const now = get(rows, s, 'Acquisition') + get(rows, s, 'Other');
      const was = get(then, s, 'Acquisition') + get(then, s, 'Other');
      const label = s === 'lybunt' ? 'LYBUNT' : s === 'lapsed' ? 'Lapsed' : 'Active';
      out.push(
        { k: label, group: 'All', now, was, change: now - was, _drill: partners({ status: [s] }) },
        { k: label, group: 'Acquisition', now: get(rows, s, 'Acquisition'), was: get(then, s, 'Acquisition'), change: get(rows, s, 'Acquisition') - get(then, s, 'Acquisition'), _drill: partners({ status: [s], cameIn: 'acquisition' }) },
        { k: label, group: 'Other', now: get(rows, s, 'Other'), was: get(then, s, 'Other'), change: get(rows, s, 'Other') - get(then, s, 'Other'), _drill: partners({ status: [s], cameIn: 'other' }) }
      );
      if (c.kpi?.status && s !== 'active') ties.push({ label: `KPI dashboard, ${label} partners`, mine: now, kpi: c.kpi.status[s], status: now === c.kpi.status[s] ? 'match' : 'differs' });
    }
    return {
      columns: [
        { key: 'k', label: 'Status', type: 'text' },
        { key: 'group', label: 'Came in through', type: 'text' },
        { key: 'now', label: 'Today', type: 'int' },
        { key: 'was', label: 'A year ago', type: 'int' },
        { key: 'change', label: 'Change', type: 'int' },
      ],
      rows: out,
      tiles: [
        { label: 'LYBUNT', value: get(rows, 'lybunt', 'Acquisition') + get(rows, 'lybunt', 'Other'), kind: 'int' },
        { label: 'Lapsed', value: get(rows, 'lapsed', 'Acquisition') + get(rows, 'lapsed', 'Other'), kind: 'int' },
      ],
      ties,
      note: 'Acquisition: the first gift came through an Acquisition appeal.',
    };
  },
};

const firstTime: ReportDef = {
  id: 'first-time',
  name: 'First-time givers',
  group: 'Partners',
  about: 'Partners whose first gift fell in the period, by the category of that first appeal.',
  params: [{ id: 'period', label: 'Period', type: 'period', def: 'ytd' }],
  async run(c) {
    const rows = await c.q(
      `SELECT COALESCE(first_cat, 'No appeal') AS k, COUNT(*) AS n, ROUND(SUM(lifetime), 2) AS t, ROUND(AVG(lifetime), 2) AS avg FROM lr_hh WHERE alive = 1 AND first_gift >= ?1 AND first_gift <= ?2 GROUP BY 1 ORDER BY n DESC`,
      [c.from, c.to]
    );
    return {
      columns: [
        { key: 'k', label: 'First appeal category', type: 'text' },
        { key: 'n', label: 'Partners', type: 'int' },
        { key: 't', label: 'Giving so far', type: 'money' },
        { key: 'avg', label: 'Average', type: 'money' },
      ],
      rows: rows.map((r) => ({ ...r, _drill: partners({ firstGift: { from: c.from, to: c.to }, firstCats: r.k === 'No appeal' ? [] : [String(r.k)] }) })),
      tiles: [{ label: 'First-time givers', value: rows.reduce((s, r) => s + n(r.n), 0), kind: 'int' }, { label: 'Giving so far', value: r2(rows.reduce((s, r) => s + n(r.t), 0)), kind: 'money' }],
      ties: [],
    };
  },
};

const retention: ReportDef = {
  id: 'retention',
  name: 'Retention',
  group: 'Partners',
  about: 'Of the partners who gave in the year before the period began, how many gave again in the period.',
  params: [{ id: 'period', label: 'Period', type: 'period', def: 'ytd' }],
  async run(c) {
    const base = [addMonthsSql(c.from, -12), addMonthsSql(c.from, -1)];
    const [r] = await c.q(
      `WITH b AS (SELECT DISTINCT household_id FROM lr_gift WHERE gift_date >= ?1 AND gift_date <= ?2),
            k AS (SELECT DISTINCT household_id FROM lr_gift WHERE gift_date >= ?3 AND gift_date <= ?4)
       SELECT (SELECT COUNT(*) FROM b JOIN lr_hh h ON h.household_id = b.household_id WHERE h.alive = 1) AS base,
              (SELECT COUNT(*) FROM b JOIN k ON k.household_id = b.household_id JOIN lr_hh h ON h.household_id = b.household_id WHERE h.alive = 1) AS kept`,
      [base[0], base[1], c.from, c.to]
    );
    const baseN = n(r?.base);
    const kept = n(r?.kept);
    return {
      columns: [
        { key: 'k', label: 'Measure', type: 'text' },
        { key: 'v', label: 'Partners', type: 'int' },
      ],
      rows: [
        { k: `Gave ${base[0]} to ${base[1]}`, v: baseN, _drill: partners({ giving: [{ from: base[0], to: base[1], min: 1, max: null }] }) },
        { k: 'Gave again in the period', v: kept, _drill: partners({ giving: [{ from: base[0], to: base[1], min: 1, max: null }, { from: c.from, to: c.to, min: 1, max: null }] }) },
        { k: 'Did not give again', v: baseN - kept, _drill: partners({ giving: [{ from: base[0], to: base[1], min: 1, max: null }, { from: c.from, to: c.to, min: null, max: 0 }] }) },
      ],
      tiles: [{ label: 'Retention', value: baseN ? `${((kept / baseN) * 100).toFixed(1)}%` : '—', kind: 'text' }],
      ties: [],
    };
  },
};

const actions: ReportDef = {
  id: 'actions',
  name: 'Actions by person and type',
  group: 'Team',
  about: 'Completed actions in the period, by the person who did them and the action type.',
  params: [{ id: 'period', label: 'Period', type: 'period', def: 'month' }],
  async run(c) {
    if (!c.mirror) return { columns: [], rows: [], tiles: [], ties: [] };
    const rows = await c.mirror(
      `SELECT COALESCE(f.fundraiser_first_name || ' ' || f.fundraiser_last_name, af.value) AS name, ac.action_type AS atype, COUNT(*) AS n
         FROM actions ac, json_each(COALESCE(json_extract(ac.raw_json, '$.fundraisers'), '[]')) af LEFT JOIN fundraisers f ON f.id = af.value
        WHERE json_extract(ac.raw_json, '$.completed') = 1 AND ac.action_type NOT LIKE 'RESERVED%' AND DATE(COALESCE(ac.action_completed_date, ac.action_date_due)) >= ?1 AND DATE(COALESCE(ac.action_completed_date, ac.action_date_due)) <= ?2
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 300`,
      [c.from, c.to]
    );
    const total = rows.reduce((s, r) => s + n(r.n), 0);
    return {
      columns: [
        { key: 'name', label: 'Person', type: 'text' },
        { key: 'atype', label: 'Action type', type: 'text' },
        { key: 'n', label: 'Completed', type: 'int' },
      ],
      rows,
      tiles: [{ label: 'Completed actions', value: total, kind: 'int' }],
      ties: [],
    };
  },
};

const grants: ReportDef = {
  id: 'grants',
  name: 'Grants pipeline',
  group: 'Team',
  about: 'Open and closed opportunities by stage, with the ask and the amount funded.',
  params: [],
  async run(c) {
    if (!c.mirror) return { columns: [], rows: [], tiles: [], ties: [] };
    const rows = await c.mirror(
      `SELECT status AS k, COUNT(*) AS n, ROUND(COALESCE(SUM(ask_amount), 0), 2) AS ask, ROUND(COALESCE(SUM(funded_amount), 0), 2) AS funded FROM opportunities WHERE COALESCE(inactive, 0) = 0 GROUP BY status ORDER BY n DESC`,
      []
    );
    return {
      columns: [
        { key: 'k', label: 'Stage', type: 'text' },
        { key: 'n', label: 'Opportunities', type: 'int' },
        { key: 'ask', label: 'Asked', type: 'money' },
        { key: 'funded', label: 'Funded', type: 'money' },
      ],
      rows,
      tiles: [{ label: 'Opportunities', value: rows.reduce((s, r) => s + n(r.n), 0), kind: 'int' }, { label: 'Funded', value: r2(rows.reduce((s, r) => s + n(r.funded), 0)), kind: 'money' }],
      ties: [],
    };
  },
};

export const REPORTS: ReportDef[] = [giving, credit, portfolio, newLost, status, firstTime, retention, actions, grants];
export const reportOf = (id: string) => REPORTS.find((r) => r.id === id) ?? null;

export const PERIODS: Array<[string, string]> = [['ytd', 'Year to date'], ['month', 'This month'], ['lastmonth', 'Last month'], ['12m', 'Last 12 months'], ['lastyear', 'Last year'], ['custom', 'Custom']];

/** A period word to the first and last day. Custom takes from and to. */
export function periodOf(word: string, today: string, from = '', to = ''): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const day = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  switch (word) {
    case 'month': return { from: day(y, m, 1), to: today };
    case 'lastmonth': return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case '12m': return { from: addMonthsSql(today, -12), to: today };
    case 'lastyear': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'custom': {
      const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));
      return ok(from) && ok(to) && from <= to ? { from, to } : { from: yearStart(today), to: today };
    }
    default: return { from: yearStart(today), to: today };
  }
}

export async function runReport(def: ReportDef, q: Q, today: string, asked: Record<string, string>, kpi: Kpi | null, mirror?: Q): Promise<ReportResult & { from: string; to: string; values: Record<string, string> }> {
  const values: Record<string, string> = {};
  for (const p of def.params) {
    const v = asked[p.id] ?? p.def;
    values[p.id] = p.type === 'select' ? ((p.options || []).some((o) => o[0] === v) ? v : p.def) : PERIODS.some((o) => o[0] === v) ? v : p.def;
  }
  const { from, to } = periodOf(values.period || 'ytd', today, asked.from, asked.to);
  const res = await def.run({ q, today, from, to, p: values, kpi, mirror });
  // Every drill spec is cleaned the same way a person's list is, so a report cannot open a list the builder would refuse.
  for (const r of res.rows) if (r._drill) r._drill = normalizeSpec(r._drill);
  return { ...res, from, to, values };
}
