import { requireActor, requireReceiptsUser } from '../../_lib/receipts/auth';
import { cleanCopy, DEFAULT_COPY } from '../../_lib/receipts/letter';
import { measure } from '../../_lib/receipts/pdf';
import { getCopy, saveCopy } from '../../_lib/receipts/store';
import { HttpError, handleError, json, type Env } from '../../_lib/http';

/** The words every letter prints. Each change keeps the wording it replaced in the log. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireReceiptsUser(env, request);
    const copy = await getCopy(env);
    const history = await env.DB.prepare("SELECT at, actor FROM rcp_log WHERE kind = 'wording' ORDER BY id DESC LIMIT 10").all<{ at: string; actor: string }>();
    const saved = await env.DB.prepare("SELECT updated_by, updated_at FROM rcp_settings WHERE key = 'copy'").first<{ updated_by: string; updated_at: string }>();
    return json({ ok: true, copy, defaults: DEFAULT_COPY, fit: measure(copy), saved, history: history.results });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireReceiptsUser(env, request);
    const actor = requireActor(request);
    const body = (await request.json().catch(() => ({}))) as { copy?: unknown; reset?: unknown };
    const copy = body.reset === true ? DEFAULT_COPY : cleanCopy(body.copy);
    const fit = measure(copy);
    if (!fit.fits) throw new HttpError(400, 'too_long', 'That is too long for the page. The letter has to end above the small print.');
    await saveCopy(env, copy, actor);
    return json({ ok: true, copy, fit });
  } catch (err) {
    return handleError(err);
  }
};
