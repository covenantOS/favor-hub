// The Favor Brain page's calls, passed to the Brain (mcp.favorintl.org/hub/...) with the hub's key and
// the signed-in person's email. The Brain keeps the access rules; the hub only says who is asking.
//
// A question is saved on the chat the moment it arrives, and the answer is finished under waitUntil, so a
// person who switches chats, goes to another page or reloads never loses it: the page reads the stored chat
// and fills the answer in when it lands.
import { errorJson, handleError, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { dropScratch, finishTurn, newConvId, recentHistory, startTurn, validConv } from '../../_lib/hub/chat';
import { retitle } from '../../_lib/hub/chat-title';

const BRAIN_URL = 'https://mcp.favorintl.org';
const ROUTES = new Set(['GET me', 'GET connector','POST request', 'POST ask', 'POST confirm', 'POST list/read', 'POST drive/search','GET admin/iwave', 'POST admin/iwave/decide', 'GET admin/names', 'POST admin/name-search', 'POST admin/alias', 'POST admin/alias-delete', 'GET admin/overview', 'POST admin/decide', 'POST admin/grant', 'POST admin/reset']);
type BrainEnv = Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string };

const headersFor = (env: BrainEnv, user: { email: string; name?: string }) => ({
  Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
  'X-Acting-Email': user.email,
  'X-Acting-Name': encodeURIComponent(user.name || user.email).replace(/%20/g, ' '),
  'Content-Type': 'application/json',
  'User-Agent': 'favor-hub',
});
const base = (env: BrainEnv) => (env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '');
const reply = (status: number, text: string) => new Response(text, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** The stored form of an answer: the rows behind a list are not kept, the preview stays. */
function stored(d: any) {
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []).map((b: any) => (b && b.type === 'table' && Array.isArray(b.rows) ? { ...b, rows: b.rows.slice(0, b.preview || 8) } : b));
  return { asked_as: d.asked_as || '', intent: d.intent || '', outcome: d.outcome || '', blocks, reading: Array.isArray(d.reading) ? d.reading : [], reading_text: d.reading_text || '', follow: Array.isArray(d.follow) ? d.follow : [], lists: Array.isArray(d.lists) ? d.lists : [], ...(d.ctx && typeof d.ctx === 'object' ? { ctx: d.ctx } : {}) };
}

async function ask(request: Request, env: BrainEnv, user: { email: string; name?: string }, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
  const raw = await request.text();
  let body: any = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    body = {};
  }
  const question = String(body.question || '').trim();
  const email = user.email.toLowerCase();
  const conv: string = validConv(body.conv) ? body.conv : newConvId();
  // The agent key and the script password session act as Will's account. Their chats are filed as 'agent' so they stay
  // out of his sidebar; a sign-in from a browser or the phone app is a person's chat.
  const source = user.via === 'agent' || user.via === 'password' ? 'agent' : 'person';
  const turn = question ? await startTurn(env, email, conv, question, source) : null;
  if (!turn) {
    // The tables are not there yet, or the chat is someone else's: answer the old way, nothing is saved here.
    const res = await fetch(`${base(env)}/hub/ask`, { method: 'POST', headers: headersFor(env, user), body: raw });
    return reply(res.status, await res.text());
  }
  const scratch = newConvId();
  // The Brain files its copy of this chat under a scratch id, so the last turns travel with the question: a follow-up like
  // "tell me more about that other category" needs the tables the last answer showed. The page cannot set this field.
  const history = await recentHistory(env, email, conv, 3);
  const job = (async () => {
    let status = 500;
    let text = '';
    try {
      const res = await fetch(`${base(env)}/hub/ask`, { method: 'POST', headers: headersFor(env, user), body: JSON.stringify({ ...body, conv: scratch, history }) });
      status = res.status;
      text = await res.text();
    } catch {
      text = JSON.stringify({ ok: false, error: 'ask', message: 'The Brain did not answer. Ask again.' });
    }
    let d: any = {};
    try {
      d = JSON.parse(text);
    } catch {
      d = {};
    }
    const ok = status < 400 && d && d.ok !== false;
    try {
      await finishTurn(env, turn.id, conv, ok ? stored(d) : { error: d.message || 'The Brain did not answer. Ask again.' }, d.ref || null);
    } catch {
      // the answer still goes to the page below
    }
    if (ok) await retitle(env, email, conv, turn.n);
    await dropScratch(env, scratch);
    if (ok) d = { ...d, conv, turn: turn.n };
    else d = { ...d, conv };
    delete d.ctx;
    return { status: ok ? status : status >= 400 ? status : 500, text: JSON.stringify(d) };
  })();
  waitUntil(job.catch(() => undefined));
  const out = await job;
  return reply(out.status, out.text);
}

export const onRequest: PagesFunction<BrainEnv> = async ({ request, env, params, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const path = ([] as string[]).concat((params.path as string[] | string) || []).join('/');
    if (!ROUTES.has(`${request.method} ${path}`)) return errorJson('not_found', 'No such brain route.', 404);
    if (!env.BRAIN_HUB_KEY) return errorJson('not_set_up', 'The Brain is not connected to the hub yet.', 503);
    if (request.method === 'POST' && path === 'ask') return await ask(request, env, user, waitUntil);
    const res = await fetch(`${base(env)}/hub/${path}`, {
      method: request.method,
      headers: headersFor(env, user),
      body: request.method === 'POST' ? await request.text() : undefined,
    });
    return reply(res.status, await res.text());
  } catch (err) {
    return handleError(err);
  }
};
