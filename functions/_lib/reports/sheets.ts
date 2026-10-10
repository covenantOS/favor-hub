// A report result as a rows-mode request for the hub's own Google Sheets export (functions/_lib/hub/sheets.ts,
// public/js/sheets.js). Nothing here talks to Google; the existing button and route do that.
import { MAX_COLS, MAX_ROWS, type ColType as SheetType, type Spec } from '../hub/sheets';
import type { ColType, RunResult } from './types';

const TYPE: Record<ColType, SheetType> = { text: 'text', id: 'id', int: 'int', money: 'money', date: 'date', pct: 'percent', chip: 'text', cell: 'money' };

export function toSheetSpec(r: RunResult, filtersInWords: string): Spec {
  const columns = r.columns.slice(0, MAX_COLS).map((c) => ({ key: c.key, label: c.label, type: TYPE[c.type || 'text'] }));
  const rows = r.rows.slice(0, MAX_ROWS) as Record<string, unknown>[];
  if (Object.keys(r.totals).length) {
    const total: Record<string, unknown> = {};
    columns.forEach((c, i) => (total[c.key] = i === 0 ? 'Total' : (r.totals[c.key] ?? null)));
    rows.push(total);
  }
  return {
    mode: 'rows',
    title: r.name,
    tabs: [{ name: r.name.slice(0, 80), columns, rows, more: r.more || r.rows.length > MAX_ROWS }],
    provenance: { kind: 'screen', page: '/reports/', filters: filtersInWords, dataAsOf: r.asOf },
  };
}
