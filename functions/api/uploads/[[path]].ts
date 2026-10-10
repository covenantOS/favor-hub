// Files attached to requests on the board, served to signed-in staff only. The middleware attaches the
// signed-in user (or the agent key) to the request; anyone else gets 401. Only request attachments
// (keys that start with req_) are served here. Expense PDFs, thank-you receipts and training videos
// have their own routes with their own checks, so those keys answer 404 on this one.
import { errorJson, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export const onRequestGet: PagesFunction<Env, 'path'> = async ({ request, env, params }) => {
  if (!hubUserOf(request)) {
    const res = errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  }
  const raw = params.path;
  const key = Array.isArray(raw) ? raw.join('/') : String(raw || '');
  if (!/^req_[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(key)) return new Response('Not found', { status: 404, headers: PRIVATE_HEADERS });
  const obj = await env.UPLOADS.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: PRIVATE_HEADERS });
  const type = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, { headers: { ...PRIVATE_HEADERS, 'Content-Type': type, 'Content-Disposition': 'inline' } });
};
