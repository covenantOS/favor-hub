import { HttpError, handleError, json, type Env } from '../../_lib/http';
import { normalizeSpec, summarize } from '../../_lib/lists/criteria.ts';
import { allRows } from '../../_lib/lists/run.ts';
import { hubQ, scopeOf, snapshotMeta, todayET } from '../../_lib/lists/service.ts';
import { csvFileName, toCsv } from '../../_lib/reports/csv';
import { MAX_COLS, MAX_ROWS, type ColType as SheetType, type Spec } from '../../_lib/hub/sheets';
import { requireWork } from '../../_lib/work/gate';
import { sameSite, body } from '../../_lib/work/route';

const SHEET_TYPE: Record<string, SheetType> = { text: 'text', id: 'id', int: 'int', money: 'money', date: 'date', chip: 'text' };

// A list as a CSV file (format=csv) or as the rows-mode request the hub's Open in Google Sheets button sends (format=sheet).
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'Reload the page and try again.');
    const wu = await requireWork(env, request);
    const b = await body(request);
    const spec = normalizeSpec(b.spec);
    const today = todayET();
    const out = await allRows(hubQ(env), spec, today, scopeOf(wu));
    const title = String(b.title || (spec.kind === 'gifts' ? 'Gift list' : 'Partner list')).slice(0, 80);
    const cols = out.columns.slice(0, MAX_COLS);
    if (String(b.format) === 'csv') {
      return new Response(toCsv(cols.map((c) => ({ key: c.key, label: c.label, type: c.type === 'money' ? 'money' : 'text' })) as any, out.rows), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${csvFileName(title.toLowerCase(), '', today)}"`, 'Cache-Control': 'no-store' },
      });
    }
    const meta = await snapshotMeta(env);
    const sheet: Spec = {
      mode: 'rows',
      title: `${title} ${today}`,
      tabs: [{ name: title.slice(0, 80), columns: cols.map((c) => ({ key: c.key, label: c.label, type: SHEET_TYPE[c.type] || 'text' })), rows: out.rows.slice(0, MAX_ROWS) as Record<string, unknown>[], more: out.capped }],
      provenance: { kind: 'screen', page: '/lists/', filters: summarize(spec).join('; '), dataAsOf: meta?.asOf ?? today },
    };
    return json({ ok: true, spec: sheet, rows: out.count.n });
  } catch (err) {
    return handleError(err);
  }
};
