import { errorJson, handleError, json, nowIso, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { audiencesOf } from '../../_lib/reports/audience';
import { csvFileName, toCsv } from '../../_lib/reports/csv';
import { mailCsv, mailTable } from '../../_lib/reports/mailfile';
import { makeMailSheet } from '../../_lib/reports/mailsheet';
import { easternToday, filtersInWords, runReport } from '../../_lib/reports/engine';
import { defOf, entryOf, mayOpen, reportName } from '../../_lib/reports/registry';
import { toSheetSpec } from '../../_lib/reports/sheets';

// One report, three ways (a report with a mail house file adds file=mail to csv, and a POST that builds the file as a Google Sheet): ?format=json (the page, the default), csv (the download) or sheet (the request the
// hub's Open in Google Sheets button sends). Filters are query parameters named by the report's own filter ids.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
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
    for (const [k, v] of url.searchParams) if (k !== 'format' && k !== 'file') asked[k] = v;
    const wantsMail = url.searchParams.get('file') === 'mail';
    const kept: { extra?: unknown } = {};
    const result = await runReport(env, def, { user: { email: user.email, name: user.name }, asked, name: reportName(id), keep: kept });
    const today = easternToday();

    const logged = env.DB.prepare('INSERT INTO rpt_runs (report_id, email, format, row_count, ran_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, user.email.toLowerCase(), format, result.count, nowIso())
      .run()
      .catch(() => undefined);
    if (typeof waitUntil === 'function') waitUntil(logged);
    else await logged;

    if (wantsMail) {
      if (!def.mailFile) return errorJson('no_mail_file', 'This report has no mail file.', 404);
      if (format !== 'csv') return errorJson('bad_format', 'The mail file downloads as CSV. Use Mail file to Sheets for a sheet.', 400);
      const mailRows = def.mailFile.rows(result.rows, result.values, kept.extra);
      return new Response('﻿' + mailCsv(def.mailFile.columns, mailRows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csvFileName(id + '-mail-file', def.fileTag ? def.fileTag(result.values) : '', today)}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
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

// POST builds the mail file as a Google Sheet in US Team Files and answers with its link. The filters come in the body.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!(request.headers.get('content-type') || '').includes('application/json')) return errorJson('bad_request', 'Send JSON.', 415);
    const id = String(params.id || '');
    const entry = entryOf(id);
    if (!entry) return errorJson('no_report', 'There is no report by that name.', 404);
    const { admin, mine } = await audiencesOf(env, user);
    if (!mayOpen(entry, mine, admin)) return errorJson('not_allowed', 'This report is for the people who use it today. Ask the technology team if yours should open it.', 403);
    const def = defOf(id);
    if (!def || !def.mailFile) return errorJson('no_mail_file', 'This report has no mail file.', 404);
    const body = (await request.json().catch(() => ({}))) as { filters?: Record<string, unknown> };
    const asked: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.filters || {})) if (typeof v === 'string') asked[k] = v;
    const kept: { extra?: unknown } = {};
    const result = await runReport(env, def, { user: { email: user.email, name: user.name }, asked, name: reportName(id), keep: kept });
    const rows = def.mailFile.rows(result.rows, result.values, kept.extra);
    const table = mailTable(def.mailFile.columns, rows);
    const today = easternToday();
    const tag = def.fileTag ? def.fileTag(result.values) : '';
    const title = [def.mailFile.name, tag, today].filter(Boolean).join(' ');
    const made = await makeMailSheet(env, title, def.mailFile.name, table.header, table.rows);
    const logged = env.DB.prepare('INSERT INTO rpt_runs (report_id, email, format, row_count, ran_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, user.email.toLowerCase(), 'mailsheet', rows.length, nowIso())
      .run()
      .catch(() => undefined);
    if (typeof waitUntil === 'function') waitUntil(logged);
    else await logged;
    return json({ ok: true, url: made.url, title: made.title, rows: made.rows });
  } catch (err) {
    return handleError(err);
  }
};
