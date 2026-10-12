import { errorJson, handleError, json, timingSafeEqualStr, type Env } from '../../../_lib/http';
import { learnMode, learnReady } from '../../../_lib/learn/db';
import { learningRecord } from '../../../_lib/learn/report';

// The Favor Brain asks what learning one person has open and what they finished. Read only, and only the asker's own
// record. It checks the shared key, that the address is a Favor address and that the person is not blocked. While Learn
// is switched off the answer is empty.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.BRAIN_HUB_KEY || !key || !timingSafeEqualStr(key, env.BRAIN_HUB_KEY)) return errorJson('signin', 'Not allowed.', 401);
    const email = String(request.headers.get('X-Acting-Email') || '').trim().toLowerCase();
    if (!/^[^@\s]+@favorintl\.org$/.test(email)) return errorJson('forbidden', 'Only Favor staff have a learning record.', 403);
    const row = await env.DB.prepare('SELECT blocked FROM hub_users WHERE email = ?').bind(email).first<{ blocked: number }>().catch(() => null);
    if (row && row.blocked) return errorJson('forbidden', 'That person is blocked in FavorOS.', 403);
    if (!(await learnReady(env)) || (await learnMode(env)) === 'off') return json({ ok: true, record: { email, completed: [], open: [] } });
    return json({ ok: true, record: await learningRecord(env, email) });
  } catch (err) {
    return handleError(err);
  }
};
