// The footer link in Chat email. Open without sign-in; the token in the link is the key. GET shows a confirmation and changes
// nothing (a mail scanner that opens the link turns nothing off); POST turns Chat email off for that address.
import type { Env } from '../_lib/http';
import { offPage } from '../_lib/chat/email';
import { turnOffWithToken } from '../_lib/chat/mail';

const ORIGIN = 'https://dash.favorintl.org';
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const u = new URL(request.url);
  const e = u.searchParams.get('e') || '';
  const t = u.searchParams.get('t') || '';
  if (!e || !t) return html(offPage({ state: 'bad', origin: ORIGIN }), 400);
  return html(offPage({ state: 'ask', email: e, action: `/chat-email/off?e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`, origin: ORIGIN }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url);
  const who = await turnOffWithToken(env, u.searchParams.get('e') || '', u.searchParams.get('t') || '').catch(() => null);
  return html(offPage({ state: who ? 'done' : 'bad', origin: ORIGIN }), who ? 200 : 400);
};
