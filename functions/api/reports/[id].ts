import { errorJson, handleError, json, nowIso, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { audiencesOf } from '../../_lib/reports/audience';
import { csvFileName, toCsv } from '../../_lib/reports/csv';
import { easternToday, filtersInWords, runReport } from '../../_lib/reports/engine';
import { defOf, entryOf, mayOpen, reportName } from '../../_lib/reports/registry';
import { toSheetSpec } from '../../_lib/reports/sheets';

// One report, three ways: ?format=json (the page, the default), csv (the download) or sheet (the request the
// hub's Open in Google Sheets button sends). Filters are query parameters named by the report's own filter ids.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const id = String(params.id || '');
    const entry = entryOf(id);
    if (!entry && id !== 'query-map') return errorJson('no_report', 'There is no report by that name.', 404);
    if (entry) {
      const { admin, mine } = await audiencesOf(env, user);
      if (!mayOpen(entry, mine, admin)) return errorJson('not_allowed', 'This report is for the people who use it today. Ask the technology team if yours should open it.', 403);
    }
    const def = defOf(id);
    if (!def) return errorJson('coming_soon', 'This report is coming soon.', 404);

    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'json';
    const asked: Record<string, string> = {};
    for (const [k, v] of url.searchParams) if (k !== 'format') asked[k] = v;
    const result = await runReport(env, def, { user: { email: user.email, name: user.name }, asked, name: reportName(id) });
    const today = easternToday();

    await env.DB.prepare('INSERT INTO rpt_runs (report_id, email, format, row_count, ran_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, user.email.toLowerCase(), format, result.count, nowIso())
      .run()
      .catch(() => undefined);

    if (format === 'csv') {
      const tag = def.fileTag ? def.fileTag(result.values) : '';
      return new Response(toCsv(result.columns, result.rows, result.totals), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csvFileName(id, tag, today)}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    if (format === 'sheet') return json({ ok: true, spec: toSheetSpec(result, filtersInWords(def, result.values)) });
    return json({ ok: true, report: result });
  } catch (err) {
    return handleError(err);
  }
};
