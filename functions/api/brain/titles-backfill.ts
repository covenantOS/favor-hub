// Titles the chats that were made before auto titles. Admins only. Each call takes up to 25 chats that have no
// title_by yet; a chat whose title is not its first question's default was typed by hand and is marked 'hand'.
// Call again until "left" is 0.
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf, isAdminEmail } from '../../_lib/session';
import { setAutoTitle, titleInputs, titleOf } from '../../_lib/hub/chat';
import { makeTitle } from '../../_lib/hub/chat-title';

const BATCH = 25;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (user.role !== 'admin' && !isAdminEmail(env, user.email)) return errorJson('forbidden', 'Only Brain admins can run this.', 403);
    const rows = ((await env.DB.prepare("SELECT id, email FROM brain_threads WHERE title_by IS NULL AND source = 'person' LIMIT ?").bind(BATCH).all<{ id: string; email: string }>()).results || []);
    let auto = 0;
    let hand = 0;
    let kept = 0;
    for (const r of rows) {
      const th = await titleInputs(env, r.email, r.id);
      if (!th) continue;
      if (th.title !== titleOf(th.first)) {
        await env.DB.prepare("UPDATE brain_threads SET title_by = 'hand' WHERE id = ?").bind(r.id).run();
        hand++;
        continue;
      }
      const t = await makeTitle(env.AI, th.questions, th.title);
      if (t && (await setAutoTitle(env, r.email, r.id, t))) auto++;
      else {
        // The model said KEEP or failed: the default title stays and the chat is marked so it is not retried.
        await env.DB.prepare("UPDATE brain_threads SET title_by = 'auto' WHERE id = ? AND title_by IS NULL").bind(r.id).run();
        kept++;
      }
    }
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM brain_threads WHERE title_by IS NULL AND source = 'person'").first<{ n: number }>();
    return json({ ok: true, auto, hand, kept, left: Number(left?.n || 0) });
  } catch (err) {
    return handleError(err);
  }
};
