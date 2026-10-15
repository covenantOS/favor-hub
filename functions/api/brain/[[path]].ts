// The Favor Brain page's calls, passed to the Brain (mcp.favorintl.org/hub/...) with the hub's key and
// the signed-in person's email. The Brain keeps the access rules; the hub only says who is asking.
//
// A question is saved on the chat the moment it arrives, and the answer is finished under waitUntil, so a
// person who switches chats, goes to another page or reloads never loses it: the page reads the stored chat
// and fills the answer in when it lands.
import { errorJson, handleError, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { fieldBrainOn } from '../../_lib/field';
import { dropScratch, finishTurn, newConvId, recentHistory, startTurn, validConv } from '../../_lib/hub/chat';
import { retitle } from '../../_lib/hub/chat-title';

const BRAIN_URL = 'https://mcp.favorintl.org';
const ROUTES = new Set(['GET me', 'GET connector','GET text/status', 'POST text/register', 'POST text/confirm', 'POST text/remove','POST request', 'POST ask', 'POST confirm', 'POST list/read', 'POST drive/search', 'GET drive/thumb','GET admin/iwave', 'POST admin/iwave/decide', 'GET admin/names', 'POST admin/name-search', 'POST admin/alias', 'POST admin/alias-delete', 'GET admin/overview', 'POST admin/decide', 'POST admin/grant', 'POST admin/reset']);
type BrainEnv = Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string };

const headersFor = (env: BrainEnv, user: { email: string; name?: string; role?: string }) => ({
  // Field staff ask with the field scope: the Brain answers from the manuals and program descriptions only.
  ...(user.role === 'field' ? { 'X-Acting-Scope': 'field' } : {}),
  Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
  'X-Acting-Email': user.email,
  'X-Acting-Name': encodeURIComponent(user.name || user.email).replace(/%20/g, ' '),
  'Content-Type': 'application/json',
  'User-Agent': 'favor-hub',
});
const base = (env: BrainEnv) => (env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '');
/**
 * A Brain list link (https://mcp.favorintl.org/csv/<token>/<name>) becomes this hub's own /api/brain/csv/<token>/<name>, which
 * downloads with the signed-in person's FavorOS session. The Brain hands the file only to the person who asked, or an admin.
 */
export const hubCsvLinks = (text: string, env: BrainEnv) => text.split(`${base(env)}/csv/`).join('/api/brain/csv/').split(`${BRAIN_URL}/csv/`).join('/api/brain/csv/');
const CSV_PATH = /^csv\/([a-z0-9]{20,40})(?:\/[A-Za-z0-9._-]{0,80})?$/;
const reply = (status: number, text: string) => new Response(text, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** The stored form of an answer: the rows behind a list are not kept, the preview stays. */
function stored(d: any) {
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []).map((b: any) => (b && b.type === 'table' && Array.isArray(b.rows) ? { ...b, rows: b.rows.slice(0, b.preview || 8) } : b));
  return { asked_as: d.asked_as || '', intent: d.intent || '', outcome: d.outcome || '', blocks, reading: Array.isArray(d.reading) ? d.reading : [], reading_text: d.reading_text || '', follow: Array.isArray(d.follow) ? d.follow : [], lists: Array.isArray(d.lists) ? d.lists : [], steps: Array.isArray(d.steps) ? d.steps.slice(0, 8) : [], ...(d.ctx && typeof d.ctx === 'object' ? { ctx: d.ctx } : {}), ...(d.written && typeof d.written === 'object' ? { written: d.written } : {}) };
}

async function ask(request: Request, env: BrainEnv, user: { email: string; name?: string; role?: string; via?: string }, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
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
    const res = await fetch(`${base(env)}/hub/ask`, { method: 'POST', headers: headersFor(env, user), body: JSON.stringify({ ...body, history: [] }) });
    return reply(res.status, hubCsvLinks(await res.text(), env));
  }
  const scratch = newConvId();
  // The Brain files its copy of this chat under a scratch id, so the last turns travel with the question: a follow-up like
  // "tell me more about that other category" needs the tables the last answer showed. The page cannot set this field.
  const history = await recentHistory(env, email, conv, 3);
  // The page can take the answer's steps as they happen (Accept: application/x-ndjson, brain-trace.js): the Brain's step lines pass
  // straight through, and the last line is the answer as stored here. Without it the reply is the answer JSON, as before.
  const live = (request.headers.get('Accept') || '').includes('application/x-ndjson');
  const ts = live ? new TransformStream<Uint8Array, Uint8Array>() : null;
  const out = ts ? ts.writable.getWriter() : null;
  const enc = new TextEncoder();
  const send = (o: unknown) => (out ? out.write(enc.encode(JSON.stringify(o) + '
')).catch(() => undefined) : Promise.resolve());
  const job = (async () => {
    let status = 500;
    let text = '';
    try {
      const h: Record<string, string> = headersFor(env, user);
      if (live) h.Accept = 'application/x-ndjson';
      const res = await fetch(`${base(env)}/hub/ask`, { method: 'POST', headers: h, body: JSON.stringify({ ...body, conv: scratch, history }) });
      status = res.status;
      if (live && res.body && (res.headers.get('Content-Type') || '').includes('ndjson')) {
        const rd = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const take = async (ln: string) => {
          if (!ln.trim()) return;
          let o: any;
          try { o = JSON.parse(ln); } catch { return; }
          if (o.steps) await send({ steps: o.steps });
          if (o.final) { text = hubCsvLinks(JSON.stringify(o.final), env); status = o.status || status; }
        };
        for (;;) {
          const r = await rd.read();
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          let i;
          while ((i = buf.indexOf('
')) >= 0) { await take(buf.slice(0, i)); buf = buf.slice(i + 1); }
        }
        await take(buf);
      } else text = hubCsvLinks(await res.text(), env);
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
    // The query behind the answer stays on the stored turn for the next question; the page never sees it.
    delete d.written;
    return { status: ok ? status : status >= 400 ? status : 500, text: JSON.stringify(d) };
  })();
  if (ts && out) {
    waitUntil(job.then((r) => send({ final: JSON.parse(r.text), status: r.status })).catch(() => send({ final: { ok: false, error: 'ask', message: 'The Brain did not answer. Ask again.' }, status: 500 })).finally(() => out.close().catch(() => undefined)));
    return new Response(ts.readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  waitUntil(job.catch(() => undefined));
  const done = await job;
  return reply(done.status, done.text);
}

export const onRequest: PagesFunction<BrainEnv> = async ({ request, env, params, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const path = ([] as string[]).concat((params.path as string[] | string) || []).join('/');
    // A list download: only for the person who asked (or a Brain admin). The Brain checks the owner against this email.
    const csv = request.method === 'GET' ? CSV_PATH.exec(path) : null;
    if (csv) {
      if (user.role === 'field') return errorJson('forbidden', 'That is not part of the field staff app.', 403);
      if (!env.BRAIN_HUB_KEY) return errorJson('not_set_up', 'The Brain is not connected to FavorOS yet.', 503);
      const res = await fetch(`${base(env)}/hub/csv/${csv[1]}`, { headers: headersFor(env, user) });
      const h = new Headers({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex', 'Content-Type': res.headers.get('Content-Type') || 'text/plain; charset=utf-8' });
      const cd = res.headers.get('Content-Disposition');
      if (cd && res.ok) h.set('Content-Disposition', cd);
      return new Response(res.body, { status: res.status === 401 ? 403 : res.status, headers: h });
    }
    if (!ROUTES.has(`${request.method} ${path}`)) return errorJson('not_found', 'No such brain route.', 404);
    // Field staff may only ask a question, and only after an admin turned the field Brain on (the Brain must honor the field scope first).
    if (user.role === 'field' && (request.method !== 'POST' || path !== 'ask')) return errorJson('forbidden', 'That is not part of the field staff app.', 403);
    if (user.role === 'field' && !(await fieldBrainOn(env))) return errorJson('not_ready', 'Favor Brain is not open to field staff yet.', 403);
    // The Brain's admin screens (grants, names, resets, iWave decisions) are for hub admins. The Brain checks its own list as well.
    if (path.startsWith('admin/') && user.role !== 'admin') return errorJson('forbidden', 'Only an admin can use that.', 403);
    if (!env.BRAIN_HUB_KEY) return errorJson('not_set_up', 'The Brain is not connected to FavorOS yet.', 503);
    if (request.method === 'POST' && path === 'ask') return await ask(request, env, user, waitUntil);
    // A photo card's picture comes through as bytes. The Brain checks the person's own Google access to the file first.
    if (request.method === 'GET' && path === 'drive/thumb') {
      const q = new URL(request.url).searchParams;
      const res = await fetch(`${base(env)}/hub/drive/thumb?id=${encodeURIComponent(q.get('id') || '')}&s=${q.get('s') === '1600' ? 1600 : 400}`, { headers: headersFor(env, user) });
      return new Response(res.ok ? res.body : null, { status: res.status, headers: { 'Content-Type': res.ok ? res.headers.get('Content-Type') || 'image/jpeg' : 'text/plain', 'Cache-Control': res.ok ? 'private, max-age=3600' : 'no-store' } });
    }
    const res = await fetch(`${base(env)}/hub/${path}`, {
      method: request.method,
      headers: headersFor(env, user),
      body: request.method === 'POST' ? await request.text() : undefined,
    });
    return reply(res.status, hubCsvLinks(await res.text(), env));
  } catch (err) {
    return handleError(err);
  }
};
