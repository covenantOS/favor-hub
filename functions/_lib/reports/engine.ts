// Runs one report definition: checks the filters, reads the mirror (SELECT only), adds the totals, tiles, the tie-out
// and the post text, and returns one result that the page, the CSV and the Sheets export all use.
import { mirror } from '../foundations/blackbaud';
import { HttpError, type Env } from '../http';
import { kpiFigures, noTie } from './tieout';
import type { ColumnDef, FilterDef, KpiFigures, ReportContext, ReportDef, Row, RunResult } from './types';

export const MAX_ROWS = 25000;
export const DEFAULT_PAGE = 200;

export const easternToday = (now = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

/** Keep only the filters the definition declares, each checked against its own type. Anything else falls back to the default. */
export function normalizeFilters(filters: FilterDef[], asked: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters) {
    const raw = asked[f.id];
    let v = raw === null || raw === undefined ? f.def : String(raw);
    if (f.type === 'seg' || f.type === 'select') {
      if (!(f.options || []).some((o) => o[0] === v)) v = f.def;
    } else if (f.type === 'date') {
      if (v !== '' && !validDate(v)) v = f.def;
    } else if (f.type === 'month') {
      if (v !== '' && !(MONTH.test(v) && Number(v.slice(5)) >= 1 && Number(v.slice(5)) <= 12)) v = f.def;
    } else {
      v = v.trim().slice(0, 80);
    }
    out[f.id] = v;
  }
  return out;
}

/** The mirror endpoint also turns writes away. This is a second lock in the hub. */
export function assertReadOnly(sql: string): void {
  const bare = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim();
  if (!/^(select|with)\b/i.test(bare)) throw new HttpError(500, 'report_sql', 'A report may only read.');
  if (/;\s*\S/.test(bare)) throw new HttpError(500, 'report_sql', 'A report runs one statement.');
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(bare)) {
    throw new HttpError(500, 'report_sql', 'A report may only read.');
  }
}

export async function loadEdits(env: Env, reportId: string): Promise<Record<string, string>> {
  const r = await env.DB.prepare('SELECT row_key, col, value FROM rpt_edits WHERE report_id = ?').bind(reportId).all<{ row_key: string; col: string; value: string }>();
  const out: Record<string, string> = {};
  for (const e of r.results || []) out[`${e.row_key}|${e.col}`] = e.value;
  return out;
}

export interface RunOptions {
  user: { email: string; name: string };
  asked: Record<string, string | null | undefined>;
  name: string;
  /** Tests give the mirror and the KPI answer; the live route leaves them out. */
  sql?: <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>;
  kpi?: () => Promise<KpiFigures | null>;
  edits?: Record<string, string>;
  today?: string;
}

function sumTotals(columns: ColumnDef[], rows: Row[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of columns) {
    if (!c.total) continue;
    let s = 0;
    for (const r of rows) s += Number(r[c.key]) || 0;
    t[c.key] = Math.round(s * 100) / 100;
  }
  return t;
}

export async function runReport(env: Env, def: ReportDef, opt: RunOptions): Promise<RunResult> {
  const values = normalizeFilters(def.filters, opt.asked);
  let figures: Promise<KpiFigures | null> | null = null;
  const edits = opt.edits ?? (def.editable ? await loadEdits(env, def.id) : {});
  const ctx: ReportContext = {
    env,
    user: opt.user,
    sql: async (sql, params = []) => {
      assertReadOnly(sql);
      return opt.sql ? opt.sql(sql, params) : (mirror(env, sql, params) as Promise<never>);
    },
    kpi: () => (figures ||= opt.kpi ? opt.kpi() : kpiFigures(env)),
    edits,
    today: opt.today || easternToday(),
    filters: values,
  };
  const loaded = await def.load(ctx, values);
  const more = loaded.rows.length > MAX_ROWS;
  let rows = more ? loaded.rows.slice(0, MAX_ROWS) : loaded.rows;
  // The page needs each row's name to save a typed-in cell against it.
  if (def.editable) rows = rows.map((r) => ({ ...r, __key: def.editable!.keyOf(r) }));
  const totals = def.totals ? def.totals(rows, values) : sumTotals(def.columns, rows);
  const tie = def.tie ? await def.tie(ctx, rows, values, loaded.extra) : noTie();
  return {
    id: def.id,
    name: opt.name,
    columns: def.columns,
    filters: def.filters,
    values,
    rows,
    count: loaded.rows.length,
    more,
    totals,
    tiles: def.tiles ? def.tiles(rows, values, loaded.extra) : [],
    tie,
    post: def.post ? def.post(rows, values, loaded.extra) : null,
    note: def.note || null,
    editable: def.editable ? def.editable.columns : [],
    asOf: loaded.asOf || ctx.today,
    pageSize: def.pageSize || DEFAULT_PAGE,
  };
}

/** The filters in words, for the Sheets provenance line and the CSV name. */
export function filtersInWords(def: ReportDef, values: Record<string, string>): string {
  return def.filters
    .filter((f) => values[f.id] !== '' && values[f.id] !== f.def)
    .map((f) => `${f.label}: ${(f.options || []).find((o) => o[0] === values[f.id])?.[1] ?? values[f.id]}`)
    .join('; ');
}
