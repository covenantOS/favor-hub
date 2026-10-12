import { errorJson, handleError, type Env } from '../../_lib/http';
import { createHubSession, hubSessionCookie, logAuth } from '../../_lib/session';
import { TESTER_COOKIE, TESTER_EMAIL, TESTER_NAME, agentKeyOk, ensureTester } from '../../_lib/testuser';

/** Signs the script in as the FavorOS Tester. Needs the agent key; every use is written to the sign-in log. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!agentKeyOk(env, request)) {
      await logAuth(env, request, TESTER_EMAIL, 'test_session_refused', 'no agent key');
      return errorJson('forbidden', 'The test session needs the agent key.', 403);
    }
    await ensureTester(env);
    const token = await createHubSession(env, request, TESTER_EMAIL);
    await logAuth(env, request, TESTER_EMAIL, 'test_session', 'agent key');
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', hubSessionCookie(token));
    // The Google step is skipped for this account, and Mail draws its sample mailbox (the page reads this cookie).
    headers.append('Set-Cookie', 'hub_gc=1; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax');
    headers.append('Set-Cookie', `${TESTER_COOKIE}=1; Path=/; Max-Age=86400; Secure; SameSite=Lax`);
    return new Response(JSON.stringify({ ok: true, user: { email: TESTER_EMAIL, name: TESTER_NAME, role: 'admin' }, cookie: token }), { status: 200, headers });
  } catch (err) {
    return handleError(err);
  }
};
