/* FavorOS service worker. One worker for the whole site (scope "/"), served from the root.
   It does four jobs and nothing else:
     1. keeps the app's own files (scripts, styles, fonts, icons) so the app opens on a weak or missing connection,
     2. keeps the /m/ start page so a home screen app opens offline,
     3. shows web push notices (a direct message or a mention) and opens the right conversation when one is tapped,
     4. forgets everything it kept when the person signs out, so a shared phone leaves nothing behind.
   Account data (/api/...) is never stored here. The pages keep what they need for offline reading in their own store. */
// The outbox code, shared with the pages, for background sending.
try { importScripts('/js/phone-core.js?v=2'); } catch { /* sends from the page instead */ }

const VERSION = 'favoros-sw-1';
const STATIC = `${VERSION}-static`;
const SHELL = `${VERSION}-shell`;
const STATIC_PREFIXES = ['/_astro/', '/_app/assets/', '/js/', '/css/', '/fonts/', '/images/'];
const SHELL_PATHS = ['/m/'];
const ICON = '/images/app-icon-192.png';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, SHELL, 'favoros-flags']);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

async function forgetEverything() {
  for (const k of await caches.keys()) await caches.delete(k);
}

// Scripts and styles change with every release: ask the network first and fall back to the kept copy only when it fails.
async function networkFirst(request) {
  const cache = await caches.open(STATIC);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 5000))]);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

// Fonts, images and hashed build files never change under the same address: the kept copy answers at once.
async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

async function shellFirstFromNetwork(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 6000))]);
    // Keep only a real page for the signed-in person, never a redirect to the sign-in page.
    if (res.ok && !res.redirected && new URL(res.url).pathname === new URL(request.url).pathname) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    return hit || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline</title><body style="font:16px system-ui;padding:24px"><h1>No connection</h1><p>FavorOS opens again when the phone is online. Messages you write are kept and sent then.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Lite mode (public/js/lite.js) sets /__lite in the favoros-flags cache. While it is set, a versioned script or style (?v=N, the
// address changes when the file does) is answered from the kept copy, and asked of the server again at most every six hours.
let liteAt = 0, liteOn = false;
async function lite() {
  if (Date.now() - liteAt < 30000) return liteOn;
  liteAt = Date.now();
  try { liteOn = !!(await (await caches.open('favoros-flags')).match('/__lite')); } catch { liteOn = false; }
  return liteOn;
}
async function keptFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const age = hit ? Date.now() - Number(hit.headers.get('x-kept-at') || 0) : Infinity;
  const refresh = async () => {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') {
      const body = await res.clone().blob();
      const h = new Headers(res.headers); h.set('x-kept-at', String(Date.now()));
      await cache.put(request, new Response(body, { status: res.status, statusText: res.statusText, headers: h }));
    }
    return res;
  };
  if (hit) {
    if (age > 6 * 3600 * 1000) refresh().catch(() => undefined);
    return hit;
  }
  return refresh();
}

const LITE_PAGES = ['/', '/chat/'];
async function litePage(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected && new URL(res.url).pathname === new URL(request.url).pathname) cache.put(new URL(request.url).pathname, res.clone());
    return res;
  } catch {
    return (await cache.match(new URL(request.url).pathname)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api/auth/logout') {
    event.respondWith(fetch(req).finally(forgetEverything));
    return;
  }
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) && !url.pathname.endsWith('/version.json')) {
    const code = url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/');
    event.respondWith(code ? (url.searchParams.has('v') ? lite().then((on) => (on ? keptFirst(req) : networkFirst(req))) : networkFirst(req)) : cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate' && SHELL_PATHS.includes(url.pathname)) { event.respondWith(shellFirstFromNetwork(req)); return; }
  // Lite mode: Today and Chat are kept too, so they open with no signal (Chat then reads its kept messages, chat.js).
  if (req.mode === 'navigate' && LITE_PAGES.includes(url.pathname)) event.respondWith(lite().then((on) => (on ? litePage(req) : fetch(req))));
});

self.addEventListener('message', (event) => {
  if (event.data === 'forget') event.waitUntil(forgetEverything());
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/* ---------------------------------------------------------------- web push */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'FavorOS', body: event.data ? event.data.text() : '' };
  }
  const title = String(data.title || 'FavorOS').slice(0, 120);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // The app is open and in front: it shows the message itself, so no second notice on top of it.
      if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) {
        wins.forEach((w) => w.postMessage({ type: 'push', data }));
        return;
      }
      // A huddle ring (functions/_lib/chat/ring.ts): Join and Decline on the notice, and it stays until answered. The missed notice
      // that follows has the same tag, so it takes the ringing one's place.
      const ring = typeof data.ring === 'string' && /^[0-9a-f]{24}$/.test(data.ring) ? data.ring : '';
      await self.registration.showNotification(title, {
        body: String(data.body || '').slice(0, 240),
        tag: data.tag || undefined,
        renotify: !!data.tag,
        icon: ICON,
        badge: ICON,
        requireInteraction: !!ring && !data.ringEnd,
        vibrate: ring && !data.ringEnd ? [400, 200, 400, 200, 400] : undefined,
        actions: ring && !data.ringEnd ? [{ action: 'join', title: 'Join' }, { action: 'decline', title: 'Decline' }] : undefined,
        data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/m/', ring: data.ringEnd ? '' : ring },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ring = (event.notification.data && event.notification.data.ring) || '';
  if (ring && event.action === 'decline') {
    event.waitUntil(fetch('/api/chat/ring/' + ring, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ action: 'decline' }) }).catch(() => undefined));
    return;
  }
  const url = (event.notification.data && event.notification.data.url) || '/m/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus();
          if ('navigate' in w) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

// Chromium can wake the app to send queued messages once the connection returns.
self.addEventListener('sync', (event) => {
  if (event.tag === 'favor-outbox') {
    // The worker sends the waiting messages itself, so they go even when FavorOS is closed (phone-core.js, loaded at the top).
    const P = self.FavorPhone;
    event.waitUntil((P ? P.createOutbox(P.idbStore(), P.chatTransport()).flush().catch(() => undefined) : Promise.resolve()).then(() =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: 'flush-outbox' })))));
  }
});
