// CSV for any report result: UTF-8 with a byte order mark (Excel and Sheets read it as text), CRLF lines,
// money with two places, and a text cell that starts like a formula kept as text.
import type { ColumnDef, Row } from './types';

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown, col?: ColumnDef): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (col?.type === 'money') return value.toFixed(2);
    if (col?.type === 'pct') return (value * 100).toFixed(1) + '%';
    return String(value);
  }
  let s = String(value);
  if (FORMULA.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(columns: ColumnDef[], rows: Row[], totals: Record<string, number> = {}): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.key], c)).join(','));
  if (Object.keys(totals).length) {
    lines.push(columns.map((c, i) => (i === 0 ? 'Total' : totals[c.key] === undefined ? '' : csvCell(totals[c.key], c))).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function csvFileName(id: string, tag: string, today: string): string {
  const safe = (x: string) => x.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return [safe(id), safe(tag), today].filter(Boolean).join('-') + '.csv';
}
