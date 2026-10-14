// A stand-in hub for the phone app and field staff tests: the real middleware and the real route files over an in-memory copy of the
// hub's tables. Google's keys, the Favor Brain and the push services are stubbed behind globalThis.fetch. Every person here is made up.
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.mjs';
import './resolve-ts.mjs';
import { idToken, googleKeys, JWKS_URL } from './mobile-harness.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
export const HOST = 'https://dash.favorintl.org';
export const WEB_CLIENT = 'web-client.apps.googleusercontent.com';
export const BRAIN = 'https://brain.test';
export const PUSH = 'https://fcm.googleapis.com';

const ROUTES = [
  ['/api/auth/google', 'functions/api/auth/google.ts'],
  ['/api/auth/nonce', 'functions/api/auth/nonce.ts'],
  ['/api/auth/me', 'functions/api/auth/me.ts'],
  ['/api/auth/logout', 'functions/api/auth/logout.ts'],
  ['/api/hub/nav', 'functions/api/hub/nav.ts'],
  ['/api/admin/people', 'functions/api/admin/people.ts'],
  ['/api/admin/settings', 'functions/api/admin/settings.ts'],
  ['/api/push/key', 'functions/api/push/key.ts'],
  ['/api/push/subscribe', 'functions/api/push/subscribe.ts'],
  ['/api/push/unsubscribe', 'functions/api/push/unsubscribe.ts'],
  ['/api/push/test', 'functions/api/push/test.ts'],
];
const CATCH = [
  ['/api/chat/', 'functions/api/chat/[[path]].ts'],
  ['/api/meet/', 'functions/api/meet/[[path]].ts'],
  ['/api/brain/', 'functions/api/brain/[[path]].ts'],
];

export async function world({ vapid = true } = {}) {
  const d1 = memoryD1();
  const signin = read('db/signin.sql').split('\n').filter((l) => !l.startsWith('ALTER TABLE')).join('\n');
  for (const f of ['work.sql', 'expenses.sql', 'reports.sql', 'admin-home.sql']) d1.exec(read('db/' + f));
  d1.exec(signin);
  d1.exec('ALTER TABLE hub_users ADD COLUMN kpi INTEGER NOT NULL DEFAULT 0;');
  d1.exec(read('db/field-staff.sql'));
  d1.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start TEXT NOT NULL);');
  for (const f of ['clips.sql', 'clips-v2.sql', 'meetings.sql', 'favor-chat.sql', 'favor-chat-private.sql', 'clip-access.sql', 'clip-share.sql']) d1.exec(read('db/' + f));
  const now = new Date().toISOString();
  d1.db.prepare(`INSERT OR IGNORE INTO hub_users (email, name, role, blocked, kpi, created_at, updated_at) VALUES ('will@favorintl.org', 'Will Hamilton', 'admin', 0, 1, ?, ?)`).run(now, now);
  d1.db.prepare(`INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('chat.enabled', 'staff', 'test', ?)`).run(now);

  const events = [];
  const room = {
    idFromName: (n) => n,
    get: () => ({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith('/event')) events.push(JSON.parse(init.body));
        if (url.endsWith('/presence')) return Response.json({});
        return new Response('ok');
      },
    }),
  };
  const files = new Map();
  const UPLOADS = {
    async put(key, buf, opts) { files.set(key, { buf, type: opts?.httpMetadata?.contentType }); },
    async get(key) { const f = files.get(key); return f ? { body: new Response(f.buf).body, httpMetadata: { contentType: f.type } } : null; },
  };
  let VAPID_JWK;
  if (vapid) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    VAPID_JWK = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  }
  const env = { DB: d1, UPLOADS, CHAT_ROOM: room, BRAIN_HUB_KEY: 'test-key', BRAIN_URL: BRAIN, HUB_SIGNIN: 'on', GOOGLE_CLIENT_ID: WEB_CLIENT, GOOGLE_JWKS_URL: JWKS_URL, HUB_ADMINS: 'will@favorintl.org', VAPID_JWK };
  const w = { d1, db: d1.db, env, events, files, brainCalls: [], pushCalls: [], pushStatus: 201, brainAnswer: { ok: true, blocks: [] } };

  const k = await googleKeys();
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === JWKS_URL) return new Response(JSON.stringify({ keys: [k.jwk] }), { status: 200, headers: { 'Cache-Control': 'max-age=60' } });
    if (u.startsWith(BRAIN)) {
      w.brainCalls.push({ url: u, headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body });
      return new Response(JSON.stringify(w.brainAnswer), { status: 200 });
    }
    if (u.startsWith(PUSH)) {
      w.pushCalls.push({ url: u, headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body });
      return new Response('', { status: typeof w.pushStatus === 'function' ? w.pushStatus(u) : w.pushStatus });
    }
    throw new Error('unexpected fetch ' + u);
  };
  return w;
}

export function addUser(w, { email, name = '', role = 'staff', blocked = 0, pending = 0, kpi = 1 }) {
  const now = new Date().toISOString();
  w.db.prepare('INSERT OR REPLACE INTO hub_users (email, name, role, blocked, pending, kpi, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(email, name || email.split('@')[0], role, blocked, pending, kpi, now, now);
}

/** A session cookie for a person already in hub_users, made the way the sign-in route makes one. */
export async function cookieFor(w, email) {
  const { createHubSession, SESSION_COOKIE } = await import('../../functions/_lib/session.ts');
  const token = await createHubSession(w.env, new Request(HOST + '/', { headers: { 'User-Agent': 'test' } }), email);
  return `${SESSION_COOKIE}=${token}`;
}

function pick(path) {
  for (const [p, file] of ROUTES) if (path === p) return { file, params: {} };
  for (const [p, file] of CATCH) if (path.startsWith(p)) return { file, params: { path: path.slice(p.length).split('/').filter(Boolean) } };
  return null;
}

/** One request through the real middleware to the route file. A path with no route file that the middleware lets through answers 200 with X-Reached. */
export async function call(w, method, path, { cookie = '', body, raw, headers = {}, host = HOST } = {}) {
  const mw = await import('../../functions/_middleware.ts');
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  const init = { method, headers: h, redirect: 'manual' };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { h.set('Content-Type', 'application/json'); init.body = JSON.stringify(body); }
  const url = new URL(path, host);
  const request = new Request(url, init);
  const route = pick(url.pathname);
  const pending = [];
  const next = async (req) => {
    if (!route) return new Response('reached', { status: 200, headers: { 'X-Reached': '1', 'Content-Type': 'text/plain' } });
    const mod = await import('../../' + route.file);
    const m = method[0] + method.slice(1).toLowerCase();
    const handler = mod['onRequest' + m] || mod.onRequest;
    return handler({ request: req || request, env: w.env, params: route.params, waitUntil: (p) => pending.push(p), next: async () => new Response('x') });
  };
  const res = await mw.onRequest({ request, env: w.env, next, waitUntil: (p) => pending.push(p) });
  await Promise.allSettled(pending);
  const text = res.status >= 300 && res.status < 400 ? '' : await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, res, reached: res.headers.get('X-Reached') === '1', location: res.headers.get('Location') || '' };
}

/** Sign in through the real nonce and Google routes with a made-up Google token. */
export async function googleSignIn(w, claims = {}) {
  const n = await call(w, 'GET', '/api/auth/nonce');
  const nonceCookie = (n.res.headers.get('Set-Cookie') || '').split(';')[0];
  const credential = await idToken({ aud: WEB_CLIENT, nonce: n.data.nonce, ...claims });
  const out = await call(w, 'POST', '/api/auth/google', { body: { credential }, cookie: nonceCookie });
  const set = out.res.headers.get('Set-Cookie') || '';
  const m = /favor_hub_session=([0-9a-f]+)/.exec(set);
  return { ...out, cookie: m ? `favor_hub_session=${m[1]}` : '' };
}

export const FIELD = (over = {}) => ({ email: 'amara@favourafrica.org', hd: 'favourafrica.org', name: 'Amara Test', ...over });
