import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { listThreads, purgeOld } from '../../_lib/hub/chat';

// The person's chats, newest first (pinned on top). ?q= also searches the questions inside each chat.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    try {
      await purgeOld(env);
    } catch {
      // the tables arrive with db/chat.sql; until then the list is empty
    }
    const q = new URL(request.url).searchParams.get('q') || '';
    let threads: Awaited<ReturnType<typeof listThreads>> = [];
    try {
      threads = await listThreads(env, user.email.toLowerCase(), q);
    } catch {
      threads = [];
    }
    return json({ ok: true, threads });
  } catch (err) {
    return handleError(err);
  }
};
