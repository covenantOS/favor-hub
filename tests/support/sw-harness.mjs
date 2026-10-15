// Runs public/sw.js in a Node VM with a fake Cache API, cookie store and window clients, so its fetch handler can be driven by a test.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

class FakeCache {
  constructor() { this.m = new Map(); }
  key(r) { return typeof r === 'string' ? r : new URL(r.url).pathname + (r.url.includes('?') ? new URL(r.url).search : ''); }
  async put(r, res) { this.m.set(this.key(r), { status: res.status, headers: [...res.headers], body: await res.text() }); }
  async match(r) {
    const e = this.m.get(this.key(r));
    return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
  }
  async delete(r) { return this.m.delete(this.key(r)); }
  async keys() { return [...this.m.keys()].map((k) => new Request('https://dash.favorintl.org' + k)); }
}

export function makeWorker({ cookies = {}, nav } = {}) {
  const handlers = {};
  const stores = new Map();
  const navigated = [];
  const state = { cookies: { ...cookies }, fetched: [] };
  const caches = {
    async open(n) { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
  };
  const sandbox = {
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Promise, Date, JSON, Number, String, Math, RegExp, Set, Map, Array, Object, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    caches,
    importScripts() { throw new Error('none'); },
    fetch: async (u, o) => { state.fetched.push(String(u.url || u)); return nav ? nav(u, o) : new Response('', { status: 200 }); },
  };
  sandbox.self = sandbox;
  sandbox.location = new URL('https://dash.favorintl.org/sw.js');
  sandbox.addEventListener = (t, f) => { handlers[t] = f; };
  sandbox.skipWaiting = () => {};
  sandbox.registration = { navigationPreload: { enable: async () => {} } };
  sandbox.clients = {
    claim: async () => {},
    matchAll: async () => [],
    get: async () => ({ navigate: async (u) => { navigated.push(u); } }),
  };
  sandbox.cookieStore = { get: async (n) => (n in state.cookies ? { name: n, value: state.cookies[n] } : null) };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  /** Drive a page load. `preload` is the server's answer the browser already asked for (navigation preload). Resolves with what the page got. */
  async function load(path, preload, init = {}) {
    const waits = [];
    let answer;
    const url = new URL('https://dash.favorintl.org' + path);
    const ev = {
      request: { url: url.toString(), method: init.method || 'GET', mode: init.mode || 'navigate', headers: new Headers() },
      preloadResponse: Promise.resolve(preload ? preload() : undefined),
      resultingClientId: 'c1',
      respondWith(p) { answer = p; },
      waitUntil(p) { waits.push(p); },
    };
    handlers.fetch(ev);
    const res = answer ? await answer : null;
    const text = res && res.body ? await res.text() : null;
    await Promise.all(waits);
    return { res, text };
  }
  async function message(data) {
    const waits = [];
    handlers.message({ data, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }
  return { load, message, caches, stores, state, navigated, handlers };
}

export const ENTRY = (n) => `/_w/index-${n}.js`;
export const webPage = (name, entry = 'A', date = 'Thu, 15 Oct 2026 12:00:00 GMT') => () =>
  new Response(`<!DOCTYPE html><html><head><script type="module" async="" src="${ENTRY(entry)}"></script></head><body><h1 id="t-hello">Good morning, ${name}</h1><li class="td-row">Gift from Pat Partner $500</li></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-hub-front': 'web', date },
  });
export const loginPage = () => {
  const r = new Response('<!DOCTYPE html><html><body>Sign in</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  Object.defineProperty(r, 'redirected', { value: true });
  return r;
};
export const WHO_A = 'a'.repeat(32);
export const WHO_B = 'b'.repeat(32);
export const signedInAs = (who, extra = {}) => ({ hub_who: who, hub_web: encodeURIComponent('/churches/~/~/work/'), ...extra });
