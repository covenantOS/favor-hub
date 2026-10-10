import { errorJson, handleError, json, nowIso, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { audiencesOf } from '../../_lib/reports/audience';
import { defOf, entryOf, mayOpen } from '../../_lib/reports/registry';

// Saves one typed-in cell (Africa income for a month, mailed quantity for an appeal). Only the columns a report
// declares as editable are accepted, and only from someone who may open that report. An empty value clears the cell.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const b = (await request.json().catch(() => null)) as { report?: string; key?: string; col?: string; value?: string } | null;
    const id = String(b?.report || '');
    const entry = entryOf(id);
    const def = defOf(id);
    if (!entry || !def || !def.editable) return errorJson('not_editable', 'That report has no typed-in cells.', 400);
    const { admin, mine } = await audiencesOf(env, user);
    if (!mayOpen(entry, mine, admin)) return errorJson('not_allowed', 'This report is for the people who use it today.', 403);
    const key = String(b?.key || '').slice(0, 120);
    const col = String(b?.col || '');
    if (!key || !def.editable.columns.includes(col)) return errorJson('bad_cell', 'That cell is not one you can type into.', 400);
    const raw = String(b?.value ?? '').replace(/[$,\s]/g, '');
    if (raw === '') {
      await env.DB.prepare('DELETE FROM rpt_edits WHERE report_id = ? AND row_key = ? AND col = ?').bind(id, key, col).run();
      return json({ ok: true, value: '' });
    }
    if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(raw)) return errorJson('bad_value', 'Type a number, for example 1250.00.', 400);
    await env.DB.prepare(
      `INSERT INTO rpt_edits (report_id, row_key, col, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id, row_key, col) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(id, key, col, raw, user.email.toLowerCase(), nowIso())
      .run();
    return json({ ok: true, value: raw });
  } catch (err) {
    return handleError(err);
  }
};
