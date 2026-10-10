import { errorJson, handleError, json, type Env } from '../../../_lib/http';
import { hubUserOf } from '../../../_lib/session';
import { deleteThread, getThread, patchThread } from '../../../_lib/hub/chat';

const ID = /^c_[a-z0-9]{4,16}$/;
const who = (request: Request) => hubUserOf(request)?.email.toLowerCase() || '';
const GONE = 'That chat is gone.';

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    const email = who(request);
    const id = String(params.id || '');
    if (!email) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!ID.test(id)) return errorJson('not_found', GONE, 404);
    const t = await getThread(env, email, id);
    return t ? json({ ok: true, ...t }) : errorJson('not_found', GONE, 404);
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    const email = who(request);
    const id = String(params.id || '');
    if (!email) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!ID.test(id)) return errorJson('not_found', GONE, 404);
    const body = (await request.json().catch(() => ({}))) as { title?: unknown; pinned?: unknown };
    return (await patchThread(env, email, id, body)) ? json({ ok: true }) : errorJson('not_found', GONE, 404);
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    const email = who(request);
    const id = String(params.id || '');
    if (!email) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!ID.test(id)) return errorJson('not_found', GONE, 404);
    return (await deleteThread(env, email, id)) ? json({ ok: true }) : errorJson('not_found', GONE, 404);
  } catch (err) {
    return handleError(err);
  }
};
