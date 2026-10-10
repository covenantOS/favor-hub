// The shared shapes of the Reports area. A report is one definition file under defs/ (columns, filters, a
// read-only loader, totals, tie-out, post text). The engine runs it; the page, CSV and Sheets all read the
// same result, so the three always show the same rows.
import type { Env } from '../http';

export type Audience = 'admin_desk' | 'operations' | 'leadership' | 'support' | 'partner_care' | 'rdd' | 'grants' | 'marketing';
export type GroupId = 'daily' | 'thanks' | 'lists' | 'results';
export type ColType = 'text' | 'id' | 'int' | 'money' | 'date' | 'pct' | 'chip' | 'cell' | 'cellint';

export interface ColumnDef {
  key: string;
  label: string;
  type?: ColType;
  /** Summed into the totals row when the definition gives no totals() of its own. */
  total?: boolean;
}

export interface FilterDef {
  id: string;
  label: string;
  type: 'seg' | 'select' | 'date' | 'month' | 'text';
  /** [value, label] pairs for seg and select. */
  options?: Array<[string, string]>;
  def: string;
  /** Show this filter only while another filter has this value. */
  showWhen?: { id: string; is: string };
}

export interface Tile {
  label: string;
  value: number | string;
  kind?: 'money' | 'int' | 'text';
  sub?: string;
}

export interface TieOut {
  /** Names the KPI figure this report overlaps, in words ("KPI dashboard, Executive, YTD revenue"). */
  label: string;
  mine: number;
  kpi: number | null;
  kind: 'money' | 'count';
  /** match: equal. differs: not equal. none: this report has no KPI line. unavailable: the KPI dashboard did not answer. */
  status: 'match' | 'differs' | 'none' | 'unavailable';
  diff?: number;
  note?: string;
}

export type Row = Record<string, unknown>;

export interface ReportContext {
  env: Env;
  user: { email: string; name: string };
  /** Read-only SQL against the Blackbaud mirror. Anything but SELECT or WITH is refused. */
  sql<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** The KPI dashboard's own figures, read once per run. */
  kpi(): Promise<KpiFigures | null>;
  /** Typed-in values for this report, keyed "rowKey|column". */
  edits: Record<string, string>;
  /** Today in Eastern time, YYYY-MM-DD. */
  today: string;
  filters: Record<string, string>;
}

export interface KpiFigures {
  asOf: string;
  /** 12 months, January first. Null where the dashboard has no value yet. */
  monthlyGiving: Array<number | null>;
  monthlyGifts: Array<number | null>;
  monthlyRecurring: Array<number | null>;
  monthlyRecurringGifts: Array<number | null>;
  ytdRevenue: number | null;
  ytdGifts: number | null;
  /** The donor status counts the sync worker computed, windows included. Lists must tie to these, never recount. */
  status: { active: number; lybunt: number; lapsed: number; activeAfter: string; lapsedOnOrBefore: string } | null;
}

export interface Loaded {
  rows: Row[];
  extra?: unknown;
  asOf?: string;
}

export interface ReportDef {
  id: string;
  filters: FilterDef[];
  columns: ColumnDef[];
  /** Rows to show on a page before the pager. Default 200. */
  pageSize?: number;
  load(ctx: ReportContext, filters: Record<string, string>): Promise<Loaded>;
  totals?(rows: Row[], filters: Record<string, string>): Record<string, number>;
  tiles?(rows: Row[], filters: Record<string, string>, extra: unknown): Tile[];
  tie?(ctx: ReportContext, rows: Row[], filters: Record<string, string>, extra: unknown): Promise<TieOut>;
  /** WhatsApp text, for the reports a person posts by hand. */
  post?(rows: Row[], filters: Record<string, string>, extra: unknown): string;
  note?: string;
  /** Typed-in columns (Africa income, mailed counts). keyOf names the row; the cells are saved in rpt_edits. */
  editable?: { keyOf(row: Row): string; columns: string[] };
  /** Part of the CSV file name, after the report id. */
  fileTag?(filters: Record<string, string>): string;
}

export interface CatalogEntry {
  id: string;
  group: GroupId;
  name: string;
  replaces: string;
  who: string;
  freq: string;
  audience: Audience[];
  /** True when the report has a figure on the KPI dashboard to tie to. */
  kpiTie: boolean;
  /** Which build group delivers it, for the coming-soon line. */
  build: 'B0' | 'B1' | 'B2' | 'B3' | 'B4';
}

export interface RunResult {
  id: string;
  name: string;
  columns: ColumnDef[];
  filters: FilterDef[];
  values: Record<string, string>;
  rows: Row[];
  count: number;
  more: boolean;
  totals: Record<string, number>;
  tiles: Tile[];
  tie: TieOut;
  post: string | null;
  note: string | null;
  editable: string[];
  asOf: string;
  pageSize: number;
}
