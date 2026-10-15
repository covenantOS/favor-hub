import { errorJson, handleError, type Env } from '../../_lib/http';
import { createHubSession, hubSessionCookie, hubWhoCookie, logAuth } from '../../_lib/session';
import { TESTER2_EMAIL, TESTER2_NAME, TESTER_EMAIL, TESTER_NAME, agentKeyOk, ensureTesters } from '../../_lib/testuser';

/** Signs the script in as the FavorOS Tester. Needs the agent key; every use is written to the sign-in log. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!agentKeyOk(env, request)) {
      await logAuth(env, request, TESTER_EMAIL, 'test_session_refused', 'no agent key');
      return errorJson('forbidden', 'The test session needs the agent key.', 403);
    }
    await ensureTesters(env);
    const body = (await request.json().catch(() => ({}))) as { who?: unknown };
    const two = String(body.who || new URL(request.url).searchParams.get('who') || '') === 'two';
    const email = two ? TESTER2_EMAIL : TESTER_EMAIL;
    const token = await createHubSession(env, request, email);
    await logAuth(env, request, email, 'test_session', 'agent key');
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', hubSessionCookie(token));
    headers.append('Set-Cookie', await hubWhoCookie(token));
    // The Google step is skipped for this account. Mail answers from a stored sample mailbox on the server.
    headers.append('Set-Cookie', 'hub_gc=1; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax');
    return new Response(JSON.stringify({ ok: true, user: { email, name: two ? TESTER2_NAME : TESTER_NAME, role: 'admin' }, cookie: token }), { status: 200, headers });
  } catch (err) {
    return handleError(err);
  }
};
