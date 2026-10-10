import { errorJson, handleError, json, timingSafeEqualStr, type Env } from '../../../_lib/http';
import { createSheet, MAX_BODY, SheetError, type Spec } from '../../../_lib/hub/sheets';

// The Favor Brain (Claude and ChatGPT) asks for a sheet for a person. The Brain already read the list under
// that person's access, so this door takes rows only. It checks the shared key, that the address is a Favor
// address, and that the person is not blocked in the hub.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.BRAIN_HUB_KEY || !key || !timingSafeEqualStr(key, env.BRAIN_HUB_KEY)) return errorJson('signin', 'Not allowed.', 401);
    const email = String(request.headers.get('X-Acting-Email') || '').trim().toLowerCase();
    if (!/^[^@\s]+@favorintl\.org$/.test(email)) return errorJson('forbidden', 'Only Favor staff can make sheets.', 403);
    const row = await env.DB.prepare('SELECT blocked FROM hub_users WHERE email = ?').bind(email).first<{ blocked: number }>().catch(() => null);
    if (row && row.blocked) return errorJson('forbidden', 'That person is blocked in the hub.', 403);
    let name = String(request.headers.get('X-Acting-Name') || email);
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep the name as sent
    }
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return errorJson('too_big', 'That is more than one sheet can take at once.', 413);
    const spec = (await request.json().catch(() => null)) as Spec | null;
    if (!spec || typeof spec !== 'object') return errorJson('bad_rows', 'Send the rows to put in the sheet.', 400);
    return json(await createSheet(env, { email, name: name.slice(0, 120), via: 'service' }, spec, undefined, { waitUntil }));
  } catch (err) {
    if (err instanceof SheetError) return json({ ok: false, error: err.code, message: err.message, ...err.extra }, err.status);
    return handleError(err);
  }
};
