import { HttpError, handleError, type Env } from '../../../_lib/http';
import { logAuth, hubUserOf } from '../../../_lib/session';
import { revokeByToken } from '../../../_lib/mobile/device';

// Sign out this phone (mobile-v1.yaml, deviceRevoke).
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!user || user.via !== 'device' || !token) throw new HttpError(401, 'signin', 'Sign in again.');
    await revokeByToken(env, token, user.email);
    await logAuth(env, request, user.email, 'native_signed_out');
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleError(err);
  }
};
