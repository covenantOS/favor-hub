// /work/partner/<id> serves the one static partner page; its script reads the id from the address and asks /api/work/partners/<id>.
// The middleware has already required sign-in, and the route behind the page checks the Work Center gate on every call.
import type { Env } from '../../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const res = await env.ASSETS.fetch(new Request(new URL('/work/partner/', request.url).toString()));
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(res.body, { status: res.status, headers });
};
