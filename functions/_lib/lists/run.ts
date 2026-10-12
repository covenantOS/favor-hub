// Runs a list spec against the lr_* snapshot: the live count, a page of rows, every row for an export, the menus the builder
// offers and the tie-out against the KPI dashboard. The database is passed in as a function so tests can use node:sqlite.
import { compile, emptySpec, plan, type ListSpec, type Scope, MAX_ROWS } from './criteria.ts';

type Row = Record<string, any>;
export type Q = (sql: string, params: unknown[]) => Promise<Row[]>;

/** D1 wants exactly as many bound values as the highest ?N in the statement. */
export function bindFor(sql: string, params: unknown[]): unknown[] {
  const used = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
  return used.length ? params.slice(0, Math.max(...used)) : [];
}

const exec = (q: Q, sql: string, params: unknown[]) => q(sql, bindFor(sql, params));

export interface Counted {
  n: number;
  total: number;
  partners: number;
}

export async function countList(q: Q, spec: ListSpec, today: string, scope: Scope): Promise<Counted> {
  const pl = plan(spec, today, scope, { limit: 1, offset: 0 });
  const r = (await exec(q, pl.countSql, pl.params))[0] || {};
  return { n: Number(r.n || 0), total: Number(r.total || 0), partners: Number(r.partners || 0) };
}

export interface Page {
  columns: Array<{ key: string; label: string; type: string }>;
  rows: Row[];
  count: Counted;
  page: number;
  pageSize: number;
}

export async function pageOf(q: Q, spec: ListSpec, today: string, scope: Scope, page: number, pageSize: number): Promise<Page> {
  const count = await countList(q, spec, today, scope);
  const pl = plan(spec, today, scope, { limit: pageSize, offset: Math.max(0, page - 1) * pageSize });
  const rows = await exec(q, pl.listSql, pl.params);
  return { columns: pl.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })), rows, count, page, pageSize };
}

/** Every matching row, capped at MAX_ROWS, for CSV and Sheets. */
export async function allRows(q: Q, spec: ListSpec, today: string, scope: Scope): Promise<Pick<Page, 'columns' | 'rows'> & { capped: boolean; count: Counted }> {
  const count = await countList(q, spec, today, scope);
  const pl = plan(spec, today, scope, { limit: MAX_ROWS, offset: 0 });
  const rows = await exec(q, pl.listSql, pl.params);
  return { columns: pl.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })), rows, capped: count.n > MAX_ROWS, count };
}

export interface Menus {
  states: string[];
  funds: Array<{ id: string; name: string; category: string; inactive: boolean }>;
  appeals: Array<{ id: string; code: string; name: string; category: string }>;
  appealCats: string[];
  fundCats: string[];
  methods: string[];
  holderTypes: string[];
  holders: Array<{ id: string; name: string; team: string }>;
  teams: Array<{ id: string; label: string }>;
  solicit: string[];
  codes: string[];
  attrs: string[];
  rels: string[];
  events: string[];
  firstCats: string[];
}

export const TEAM_LABEL: Record<string, string> = { support: 'Support', rdd: 'RDDs', partner_care: 'Partner Care', church: 'Church Engagement', grants: 'Grants', admin: 'Operations', exec: 'Leadership' };

const col = async (q: Q, sql: string): Promise<string[]> => (await q(sql, [])).map((r) => String(r.v)).filter((v) => v && v !== 'null');

export async function menus(q: Q): Promise<Menus> {
  const [states, funds, appeals, appealCats, fundCats, methods, holderTypes, holders, teams, solicit, codes, attrs, rels, events, firstCats] = await Promise.all([
    col(q, `SELECT DISTINCT upper(state) AS v FROM lr_hh WHERE state IS NOT NULL AND length(state) = 2 ORDER BY 1`),
    q(`SELECT id, name, category, inactive FROM lr_fund ORDER BY inactive, name`, []),
    q(`SELECT id, code, name, category FROM lr_appeal ORDER BY start DESC, code`, []),
    col(q, `SELECT DISTINCT category AS v FROM lr_appeal WHERE category IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT category AS v FROM lr_fund WHERE category IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT method AS v FROM lr_gift WHERE method IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT atype AS v FROM lr_holder ORDER BY 1`),
    q(
      `SELECT f.id AS id, f.name AS name, COALESCE(s.team, '') AS team FROM lr_fr f LEFT JOIN act_staff s ON s.bb_fundraiser_id = f.id AND s.active = 1
        WHERE f.id IN (SELECT DISTINCT fundraiser_id FROM lr_holder) OR f.active = 1 ORDER BY f.name`,
      []
    ),
    col(q, `SELECT DISTINCT team AS v FROM act_staff WHERE active = 1 AND bb_fundraiser_id IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'solicit' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'code' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'attr' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'rel' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'event' ORDER BY 1`),
    col(q, `SELECT DISTINCT first_cat AS v FROM lr_hh WHERE first_cat IS NOT NULL ORDER BY 1`),
  ]);
  return {
    states,
    funds: funds.map((f) => ({ id: String(f.id), name: String(f.name ?? f.id), category: String(f.category ?? ''), inactive: Number(f.inactive) === 1 })),
    appeals: appeals.map((a) => ({ id: String(a.id), code: String(a.code ?? a.id), name: String(a.name ?? ''), category: String(a.category ?? '') })),
    appealCats,
    fundCats,
    methods,
    holderTypes,
    holders: holders.map((h) => ({ id: String(h.id), name: String(h.name), team: String(h.team) })),
    teams: teams.map((t) => ({ id: t, label: TEAM_LABEL[t] || t })),
    solicit,
    codes,
    attrs,
    rels,
    events,
    firstCats,
  };
}

export interface Tie {
  label: string;
  mine: number;
  kpi: number | null;
  status: 'match' | 'differs' | 'none' | 'unavailable';
  note?: string;
}

/**
 * The KPI dashboard counts active households without the living check and LYBUNT and lapsed with it. A list that is only a status
 * (and nothing else) is counted on that basis and compared with the dashboard's own figure. Any other list has no KPI line.
 */
export async function tieOut(q: Q, spec: ListSpec, today: string, kpi: { active: number; lybunt: number; lapsed: number } | null): Promise<Tie | null> {
  const p = spec.partner;
  const base = emptySpec('partners');
  const probe = { ...spec, partner: { ...p, status: [], deceased: 'exclude' }, columns: [], sort: base.sort };
  const plain = JSON.stringify(probe) === JSON.stringify(base);
  if (!plain || p.status.length !== 1) return null;
  const s = p.status[0];
  const basis: ListSpec = { ...spec, partner: { ...p, deceased: s === 'active' ? 'include' : 'exclude' } };
  const mine = (await countList(q, basis, today, { all: true, fids: [] })).n;
  const label = `KPI dashboard, Executive, ${s === 'lybunt' ? 'LYBUNT' : s} partners`;
  if (!kpi) return { label, mine, kpi: null, status: 'unavailable' };
  const theirs = kpi[s];
  return { label, mine, kpi: theirs, status: mine === theirs ? 'match' : 'differs', note: mine === theirs ? undefined : 'The dashboard figure is its last nightly build; gifts entered since then are in this list.' };
}

export { compile };
