import { notificationsFor } from '../../_lib/hub/notifications';
import { accessOf } from '../../_lib/hub/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// What the bell lists beyond its four own sources: meetings starting soon or live, Learning, Evaluations, Expenses, Receipts, Feedback,
// Favor Brain access requests and unread Mail. Read-only; each row clears on the page it opens.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const access = await accessOf(env, request, user);
    return json({ ok: true, ...(await notificationsFor(env, user, access)) });
  } catch (err) {
    return handleError(err);
  }
};
