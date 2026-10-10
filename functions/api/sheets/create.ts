import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { createSheet, MAX_BODY, SheetError, type Spec } from '../../_lib/hub/sheets';

// A hub page asks for a Google Sheet in the signed-in person's own Drive. The page says what to put in it
// (rows it already shows, or the tokens of a Favor Brain list); this checks who is asking and builds it.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return errorJson('too_big', 'That is more than one sheet can take at once.', 413);
    const spec = (await request.json().catch(() => null)) as Spec | null;
    if (!spec || typeof spec !== 'object') return errorJson('bad_rows', 'Send the rows to put in the sheet.', 400);
    const made = await createSheet(env, { email: user.email, name: user.name, via: 'session' }, spec);
    return json(made);
  } catch (err) {
    if (err instanceof SheetError) return json({ ok: false, error: err.code, message: err.message, ...err.extra }, err.code === 'consent' || err.code === 'not_connected' ? 200 : err.status);
    return handleError(err);
  }
};
