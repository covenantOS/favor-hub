// The mail house file and the saved-query tie-out lines for the two address lists (Appeal mailing list, Annual tax receipt lists).
//
// A saved query's export has its own headers and value forms: a state spelled out, a date as "10/1/2026 12:00:00 AM", an amount
// without trailing zeros, the record id as QRECID. The mail house reads those columns, so the hub's mail file prints the same
// ones, from the same stored names (Primary Salutation and Primary Addressee come from Blackbaud, not from a hub rule).
import { SAVED_RUNS } from './saved-runs';
import type { ColumnDef, Row, TieOut } from './types';

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', VI: 'Virgin Islands', GU: 'Guam',
  MB: 'Manitoba', ON: 'Ontario', NSW: 'New South Wales', SA: 'South Australia', VIC: 'Victoria',
};

/** The state as the Blackbaud export spells it. A value that is not a known abbreviation prints as it is on the record. */
export function stateName(value: unknown): string {
  const s = String(value ?? '').trim();
  return STATES[s.toUpperCase()] ?? s;
}

/** An amount the way the export prints it: 600, 257.55, no thousands mark, no trailing zeros. */
export function moneyText(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

/** M/D/YYYY 12:00:00 AM, the date form of the saved export. */
export function dateText(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  return `${Number(m[2])}/${Number(m[3])}/${m[1]} 12:00:00 AM`;
}

/** Address lines come as one text with line breaks: the first is the block, the rest the unit line. The export keeps the lines as typed. */
export function splitAddress(lines: unknown): { block: string; unit: string } {
  const parts = String(lines ?? '').split(/\r?\n/);
  return { block: parts[0] ?? '', unit: parts.slice(1).join(', ') };
}

export function byText(a: unknown, b: unknown): number {
  return String(a ?? '').toLowerCase().localeCompare(String(b ?? '').toLowerCase());
}

/**
 * The line under a list that ties it to the saved query it replaces. The saved run is a stored figure (partners, dollars) from
 * running that query on the date shown, for the same inputs; when the inputs differ no line is drawn.
 */
export function savedTie(report: string, inputs: Record<string, string | undefined>, partners: number, total: number | null, more: { list?: string; note?: string } = {}): TieOut[] {
  const run = SAVED_RUNS.find((r) => r.report === report && (r.list ?? more.list) === more.list && Object.entries(r.inputs).every(([k, v]) => (inputs[k] ?? '') === v));
  if (!run) return [];
  const against = `Saved query ${run.query}, ${run.name}, run ${run.ran}`;
  const out: TieOut[] = [];
  const count = (): TieOut => {
    const diff = Math.abs(partners - run.partners);
    return { label: 'Partners', mine: partners, kpi: run.partners, kind: 'count', status: diff === 0 ? 'match' : 'differs', diff, against, note: [run.rows !== run.partners ? `The saved file has ${run.rows} rows for ${run.partners} partners.` : '', diff !== 0 ? run.named || '' : '', more.note || ''].filter(Boolean).join(' ') || undefined };
  };
  out.push(count());
  if (total !== null && run.total !== null) {
    const diff = Math.round(Math.abs(total - run.total) * 100) / 100;
    out.push({ label: run.totalLabel, mine: total, kpi: run.total, kind: 'money', status: diff < 0.005 ? 'match' : 'differs', diff: diff < 0.005 ? 0 : diff, against });
  }
  return out;
}

export interface SheetValues {
  title: string;
  header: string[];
  rows: string[][];
}

/** The mail file as text cells, in the saved file's column order. */
export function mailTable(columns: ColumnDef[], rows: Row[]): { header: string[]; rows: string[][] } {
  return { header: columns.map((c) => c.label), rows: rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))) };
}

/** CSV of the mail file in the form the saved export used: every cell in quotes, CRLF lines. */
export function mailCsv(columns: ColumnDef[], rows: Row[]): string {
  const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [columns.map((c) => c.label).join(',')];
  for (const r of rows) lines.push(columns.map((c) => q(r[c.key])).join(','));
  return lines.join('\r\n') + '\r\n';
}
